-- Wormy: package tracking updates, and search that scales.
--
-- Tracking. When EasyPost is set up, every scan the carrier reports (label created, in transit,
-- out for delivery, delivered, problems) is saved on the exchange, so both readers see where the
-- book is and when it's expected. "Delivered" starts the 2-day confirm window as before.
--
-- Search. Readers search the whole catalog in the database instead of only the books their app
-- has loaded:
--   * typo-tolerant title and author matching (trigram similarity), and ISBN-10 or -13 lookups;
--   * editions of the same book are grouped (same title and author), so "Dune" is one result
--     with every copy of every edition behind it;
--   * each result says how many copies anyone can request right now;
--   * a wishlist entry covers every edition: listing any edition alerts the reader, and
--     receiving any edition takes it off their wishlist;
--   * when nobody has a book, similar_books suggests ones that are available now: same author
--     first, then same genre, then the most wanted.
-- The catalog itself grows from what readers scan, wish for and look up (the add-book function).

-- ---------------------------------------------------------------------------------------------
-- Tracking

alter table public.exchanges
  add column tracking_status text check (tracking_status in
    ('unknown','pre_transit','in_transit','out_for_delivery','delivered','available_for_pickup','return_to_sender','failure','cancelled','error')),
  add column tracking_detail text check (char_length(tracking_detail) <= 200),
  add column tracking_where text check (char_length(tracking_where) <= 80),
  add column tracking_eta timestamptz,
  add column tracking_at timestamptz;

-- Called by the tracking webhook for every update EasyPost sends.
create function public.set_tracking_status(p_tracker text, p_status text, p_detail text, p_where text, p_eta timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x public.exchanges;
  st text := case when p_status in ('pre_transit','in_transit','out_for_delivery','delivered','available_for_pickup',
                                    'return_to_sender','failure','cancelled','error') then p_status else 'unknown' end;
  t text;
begin
  select * into x from public.exchanges where tracker_id = p_tracker for update;
  if x.id is null then return false; end if;
  t := public._title((select isbn from public.copies where id = x.copy_id));
  update public.exchanges
     set tracking_status = st, tracking_detail = left(nullif(btrim(p_detail), ''), 200),
         tracking_where = left(nullif(btrim(p_where), ''), 80), tracking_eta = p_eta, tracking_at = now()
   where id = x.id;
  if st is distinct from x.tracking_status and x.status = 'shipped' then
    if st = 'out_for_delivery' then
      perform public._notify(x.recipient_id, t || ' is out for delivery', 'It should arrive today.', jsonb_build_object('request', x.request_id));
    elsif st = 'available_for_pickup' then
      perform public._notify(x.recipient_id, t || ' is waiting at the post office',
        coalesce(p_detail, 'The carrier is holding it for pickup.'), jsonb_build_object('request', x.request_id));
    elsif st in ('return_to_sender','failure','error') then
      perform public._log(x.request_id, 'Tracking problem: ' || coalesce(nullif(btrim(p_detail), ''), replace(st, '_', ' ')) || '.');
      perform public._notify(x.sender_id, 'A problem with ' || t || '''s delivery',
        coalesce(p_detail, 'The carrier reported a problem.') || ' Check tracking, or contact support.', jsonb_build_object('request', x.request_id));
      perform public._notify(x.recipient_id, 'A problem with ' || t || '''s delivery',
        coalesce(p_detail, 'The carrier reported a problem.'), jsonb_build_object('request', x.request_id));
    end if;
  end if;
  if st = 'delivered' then perform public.mark_delivered(p_tracker); end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Search

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Editions of one book share a key: the title without subtitle, series note or leading article,
-- and the first author's surname. "The Name of the Wind (Kingkiller Chronicle #1)" by
-- "Rothfuss, Patrick" and "Name of the Wind" by "Patrick Rothfuss" both become nameofthewind|rothfuss.
create function public._work_key(p_title text, p_author text) returns text language sql immutable as $$
  select regexp_replace(lower(regexp_replace(split_part(split_part(coalesce(p_title, ''), ':', 1), '(', 1), '^\s*(the|a|an)\s+', '', 'i')), '[^a-z0-9]+', '', 'g')
      || '|' || coalesce((regexp_match(lower(split_part(coalesce(p_author, ''), ',', 1)), '([a-z''-]+)\s*$'))[1], '')
$$;
alter table public.books add column work_key text generated always as (public._work_key(title, author)) stored;
create index books_work on public.books(work_key);
create index books_title_trgm on public.books using gin (lower(title) extensions.gin_trgm_ops);
create index books_author_trgm on public.books using gin (lower(author) extensions.gin_trgm_ops);

-- ISBN-10 or -13 (any spacing or dashes) to ISBN-13, or null if it isn't one.
create function public._isbn13(p text) returns text language plpgsql immutable as $$
declare
  s text := regexp_replace(upper(coalesce(p, '')), '[^0-9X]', '', 'g');
  body text;
  total int := 0;
begin
  if s ~ '^97[89][0-9]{10}$' then return s; end if;
  if s !~ '^[0-9]{9}[0-9X]$' then return null; end if;
  body := '978' || left(s, 9);
  for i in 1..12 loop total := total + substr(body, i, 1)::int * case when i % 2 = 0 then 3 else 1 end; end loop;
  return body || ((10 - total % 10) % 10)::text;
end $$;

-- Copies anyone could request right now: open listing, owner still around, not in an exchange.
create function public._requestable() returns table (listing_id uuid, copy_id uuid, isbn text, owner_id uuid, opened_at timestamptz)
language sql stable as $$
  select l.id, c.id, c.isbn, c.owner_id, l.opened_at
    from public.listings l
    join public.copies c on c.id = l.copy_id and c.removed_at is null
    join public.profiles o on o.id = c.owner_id and o.deleted_at is null
   where l.closed_at is null
     and not exists (select 1 from public.exchanges e where e.copy_id = c.id
                     and e.status in ('accepted','shipped','delivered','disputed'))
$$;

-- Turns a ranked list of books into results grouped by edition, plus everything the app needs to
-- show them (books, a few available copies per book, and their owners' public profiles).
create function public._book_bundle(u uuid, p_isbns text[]) returns jsonb language sql stable as $$
  with
  hits as (select b.work_key, min(t.ord) as ord
             from unnest(p_isbns) with ordinality as t(isbn, ord) join public.books b on b.isbn = t.isbn
            group by b.work_key),
  eds as (select b.* from public.books b where b.work_key in (select work_key from hits)),
  av as (select r.*, e.work_key, row_number() over (partition by e.work_key order by r.opened_at desc) as n
           from public._requestable() r join eds e on e.isbn = r.isbn
          where r.owner_id is distinct from u),
  shown as (select * from av where n <= 6),
  owners as (select distinct owner_id from shown)
  select jsonb_build_object(
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'work', h.work_key,
        'isbn', coalesce(
          (select a.isbn from av a where a.work_key = h.work_key group by a.isbn order by count(*) desc, a.isbn limit 1),
          (select t.isbn from unnest(p_isbns) with ordinality as t(isbn, ord) join eds e on e.isbn = t.isbn
            where e.work_key = h.work_key order by t.ord limit 1)),
        'editions', (select count(*) from eds e where e.work_key = h.work_key),
        'available', (select count(*) from av a where a.work_key = h.work_key),
        'wished', exists (select 1 from public.wishlist w join eds e on e.isbn = w.isbn where w.user_id = u and e.work_key = h.work_key),
        'wanted', (select count(distinct w.user_id) from public.wishlist w join eds e on e.isbn = w.isbn where e.work_key = h.work_key))
      order by h.ord) from hits h), '[]'),
    'books', coalesce((select jsonb_object_agg(e.isbn, jsonb_build_object(
        'id', e.isbn, 'isbn', e.isbn, 'title', e.title, 'author', e.author, 'year', e.year,
        'genre', coalesce(e.genre, 'Other'), 'cover', e.cover_url, 'summary', e.summary, 'work', e.work_key)) from eds e), '{}'),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.listing_id, 'copyId', s.copy_id, 'openedAt', public._ms(s.opened_at), 'closedAt', null)) from shown s), '[]'),
    'copies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'owner', c.owner_id, 'bookId', c.isbn, 'cond', c.condition, 'format', c.format,
        'flags', to_jsonb(c.flags), 'addedAt', public._ms(c.acquired_at), 'history', public._copy_history(c.id)))
      from public.copies c where c.id in (select copy_id from shown)), '[]'),
    'users', coalesce((select jsonb_object_agg(p.id, jsonb_build_object(
        'name', p.display_name, 'handle', p.handle, 'city', concat_ws(', ', p.city, p.state), 'avatar', p.avatar_path,
        'rating', (select round(avg(stars), 1) from public.ratings where ratee_id = p.id),
        'ratings', (select count(*) from public.ratings where ratee_id = p.id),
        'condRated', (public._cond_record(p.id)).rated, 'condAccurate', (public._cond_record(p.id)).accurate))
      from public.profiles p where p.id in (select owner_id from owners)), '{}'))
$$;

-- Search the catalog by title, author or ISBN. Up to 30 books, closest matches first.
create function public.search_books(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  u uuid := public._uid();
  q text := lower(btrim(left(coalesce(p_q, ''), 100)));
  isbn text := public._isbn13(p_q);
  pat text;
begin
  if u is null then raise exception 'Please sign in.'; end if;
  if isbn is not null then return public._book_bundle(u, array[isbn]); end if;
  if char_length(q) < 2 then return public._book_bundle(u, array[]::text[]); end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return public._book_bundle(u, array(
    select b.isbn from public.books b
     where lower(b.title) % q or lower(b.author) % q or lower(b.title) like pat or lower(b.author) like pat
        or word_similarity(q, lower(b.title)) > 0.6 or word_similarity(q, lower(b.author)) > 0.6
     order by greatest(similarity(lower(b.title), q), word_similarity(q, lower(b.title)),
                       0.9 * similarity(lower(b.author), q), 0.9 * word_similarity(q, lower(b.author))) desc, b.isbn
     limit 30));
end $$;

-- Books someone could request right now, for "you might like" and "not on anyone's shelf yet":
-- same author first, then same genre, then the most wanted. Without a book, just the most wanted.
create function public.similar_books(p_isbn text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._uid();
  src public.books;
begin
  if u is null then raise exception 'Please sign in.'; end if;
  select * into src from public.books where isbn = p_isbn;
  return public._book_bundle(u, array(
    select x.isbn from (
      select distinct on (b.work_key) b.isbn,
             case when src.isbn is not null and split_part(b.work_key, '|', 2) = split_part(src.work_key, '|', 2)
                       and split_part(b.work_key, '|', 2) <> '' then 4 else 0 end
             + case when src.genre is not null and b.genre = src.genre then 2 else 0 end
             + least(10, (select count(*) from public.wishlist w where w.isbn = b.isbn)) * 0.1 as score
        from public.books b
        join public._requestable() r on r.isbn = b.isbn and r.owner_id <> u
       where src.isbn is null or b.work_key <> src.work_key
       order by b.work_key, score desc) x
     order by x.score desc, x.isbn
     limit 8));
end $$;

-- A wishlist entry covers every edition: listing any edition alerts the readers who want it.
create or replace function public._open_listing(p_copy uuid) returns uuid language plpgsql as $$
declare
  c public.copies;
  l uuid;
begin
  select * into c from public.copies where id = p_copy;
  insert into public.listings (copy_id) values (p_copy) on conflict do nothing returning id into l;
  if l is null then return null; end if;
  insert into public.notifications (user_id, title, body, link)
  select distinct on (w.user_id) w.user_id,
         public._title(c.isbn) || ' is available',
         public._name(c.owner_id) || ' listed a ' || public._cond_label(c.condition) || ' copy. It''s on your wishlist.',
         jsonb_build_object('listing', l, 'isbn', c.isbn)
  from public.wishlist w
  join public.profiles p on p.id = w.user_id and p.deleted_at is null
  where w.isbn in (select isbn from public.books where work_key = (select work_key from public.books where isbn = c.isbn))
    and w.user_id <> c.owner_id
    and not exists (select 1 from public.notifications n
                    where n.user_id = w.user_id and n.link ->> 'isbn' = c.isbn
                      and n.created_at > now() - interval '1 day');
  return l;
end $$;

-- ...and receiving any edition takes the book off the wishlist.
create function public._clear_wishlist_on_complete() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  delete from public.wishlist w
   where w.user_id = new.recipient_id
     and w.isbn in (select b.isbn from public.books b
                     where b.work_key = (select b2.work_key from public.copies c join public.books b2 on b2.isbn = c.isbn where c.id = new.copy_id));
  return new;
end $$;
create trigger exchanges_clear_wishlist after update of status on public.exchanges
  for each row when (new.status = 'complete' and old.status is distinct from 'complete')
  execute function public._clear_wishlist_on_complete();

create or replace function public.get_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._uid();
  prof public.profiles;
  result jsonb;
begin
  select * into prof from public.profiles where id = u and deleted_at is null;

  with
  mr as (select * from public.requests where sender_id = u or recipient_id = u),
  ol as (
    select l.* from public.listings l
    join public.copies c on c.id = l.copy_id
    join public.profiles o on o.id = c.owner_id and o.deleted_at is null
    where l.closed_at is null and c.removed_at is null
    order by l.opened_at desc limit 500),
  vl as (
    select * from ol
    union
    select l.* from public.listings l where l.id in (select listing_id from mr)
    union
    select l.* from public.listings l join public.copies c on c.id = l.copy_id
      where c.owner_id = u and c.removed_at is null and l.closed_at is null),
  vc as (
    select * from public.copies c
    where (c.owner_id = u and c.removed_at is null)
       or c.id in (select copy_id from vl)
       or c.id in (select copy_id from mr)),
  mx as (select * from public.exchanges where request_id in (select id from mr)),
  vu as (
    select owner_id as id from vc union select sender_id from mr union select recipient_id from mr),
  vb as (
    select * from public.books where isbn in (
      select isbn from vc union select isbn from public.wishlist where user_id = u union select isbn from mr))
  select jsonb_build_object(
    'now', public._ms(now()),
    'me_id', u,
    'me', case when prof.id is null then jsonb_build_object('onboarded', false) else jsonb_build_object(
      'onboarded', true,
      'name', prof.display_name,
      'handle', prof.handle,
      'photo', prof.avatar_path,
      'city', prof.city,
      'state', prof.state,
      'genres', to_jsonb(prof.genres),
      'welcome', prof.welcome,
      'strikes', public._strike_count(u),
      'paused', public._paused(u),
      'admin', prof.is_admin,
      'address', (select jsonb_build_object('name', a.name, 'line1', a.line1, 'line2', a.line2, 'city', a.city, 'state', a.state, 'zip', a.zip)
                  from public.addresses a where a.user_id = u)) end,
    'fees', jsonb_build_object(
      'sender', (public._setting('pricing') ->> 'sender_cents')::int / 100.0,
      'recipient', (public._setting('pricing') ->> 'recipient_cents')::int / 100.0),
    'topupAmounts', public._setting('topup_amounts'),
    'welcomeListings', coalesce((public._setting('welcome') ->> 'listings')::int, 3),
    'users', coalesce((select jsonb_object_agg(p.id, jsonb_build_object(
        'name', p.display_name,
        'handle', p.handle,
        'city', concat_ws(', ', p.city, p.state),
        'avatar', p.avatar_path,
        'rating', (select round(avg(stars), 1) from public.ratings where ratee_id = p.id),
        'ratings', (select count(*) from public.ratings where ratee_id = p.id),
        'condRated', (public._cond_record(p.id)).rated,
        'condAccurate', (public._cond_record(p.id)).accurate))
      from public.profiles p where p.id in (select id from vu) and p.id <> u), '{}'),
    'books', coalesce((select jsonb_object_agg(b.isbn, jsonb_build_object(
        'id', b.isbn, 'isbn', b.isbn, 'title', b.title, 'author', b.author, 'year', b.year,
        'genre', coalesce(b.genre, 'Other'), 'cover', b.cover_url, 'summary', b.summary, 'work', b.work_key)) from vb b), '{}'),
    'copies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'owner', c.owner_id, 'bookId', c.isbn, 'cond', c.condition, 'format', c.format,
        'flags', to_jsonb(c.flags), 'addedAt', public._ms(c.acquired_at),
        'history', public._copy_history(c.id))) from vc c), '[]'),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'copyId', l.copy_id, 'openedAt', public._ms(l.opened_at), 'closedAt', public._ms(l.closed_at))) from vl l), '[]'),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'listingId', r.listing_id, 'copyId', r.copy_id, 'bookId', r.isbn,
        'sender', r.sender_id, 'recipient', r.recipient_id, 'at', public._ms(r.created_at), 'status', r.status,
        'listedCond', r.listed_condition,
        'fees', jsonb_build_object('sender', r.fee_sender_cents / 100.0, 'recipient', r.fee_recipient_cents / 100.0),
        'log', coalesce((select jsonb_agg(jsonb_build_object('at', public._ms(e.at), 'text', e.text) order by e.id)
                         from public.request_events e where e.request_id = r.id), '[]'))) from mr r), '[]'),
    'exchanges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'requestId', x.request_id, 'copyId', x.copy_id, 'sender', x.sender_id, 'recipient', x.recipient_id,
        'status', x.status, 'acceptedAt', public._ms(x.accepted_at), 'shipBy', public._ms(x.ship_by),
        'carrier', x.carrier, 'tracking', x.tracking, 'shippedAt', public._ms(x.shipped_at),
        'deliveredAt', public._ms(x.delivered_at), 'completedAt', public._ms(x.completed_at),
        'dispute', x.dispute_reason, 'outcome', x.outcome,
        'rated', (select stars from public.ratings where request_id = x.request_id and rater_id = u),
        'receivedCond', x.received_condition,
        'trackStatus', x.tracking_status, 'trackDetail', x.tracking_detail, 'trackWhere', x.tracking_where,
        'trackEta', public._ms(x.tracking_eta), 'trackAt', public._ms(x.tracking_at),
        -- The street address is shared only with the sender, only while they need it to ship.
        'shipTo', case when x.sender_id = u and x.status = 'accepted' then
          (select jsonb_build_object('name', a.name, 'line1', a.line1, 'line2', a.line2, 'city', a.city, 'state', a.state, 'zip', a.zip)
           from public.addresses a where a.user_id = x.recipient_id) end)) from mx x), '[]'),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'user', e.user_id, 'type', e.type, 'requestId', e.request_id, 'at', public._ms(e.created_at), 'note', e.note) order by e.id)
      from public.credit_entries e where e.user_id = u), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'user', p.user_id, 'kind', p.kind, 'amount', p.amount_cents / 100.0,
        'requestId', p.request_id, 'at', public._ms(p.created_at), 'note', p.note) order by p.id)
      from public.payments p where p.user_id = u), '[]'),
    'wishlist', coalesce((select jsonb_agg(isbn order by created_at) from public.wishlist where user_id = u), '[]'),
    'trend', coalesce((select jsonb_object_agg(t.isbn, t.score) from (
        select c.isbn,
               2 * (select count(*) from public.wishlist w where w.isbn = c.isbn)
               + (select count(*) from public.requests r where r.isbn = c.isbn and r.created_at > now() - interval '14 days') as score
        from public.copies c where c.id in (select copy_id from ol) group by c.isbn) t), '{}'),
    -- Support accounts also get the open problem reports to rule on.
    'disputes', case when prof.is_admin then coalesce((select jsonb_agg(jsonb_build_object(
        'requestId', x.request_id, 'title', b.title, 'reason', x.dispute_reason, 'condition', c.condition,
        'sender', ps.display_name, 'senderHandle', ps.handle, 'recipient', pr.display_name, 'recipientHandle', pr.handle,
        'carrier', x.carrier, 'tracking', x.tracking, 'shippedAt', public._ms(x.shipped_at)) order by x.shipped_at)
      from public.exchanges x
      join public.copies c on c.id = x.copy_id
      join public.books b on b.isbn = c.isbn
      join public.profiles ps on ps.id = x.sender_id
      join public.profiles pr on pr.id = x.recipient_id
      where x.status = 'disputed'), '[]') end,
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'at', public._ms(n.created_at), 'title', n.title, 'body', n.body, 'go', n.link, 'read', n.read_at is not null)
        order by n.created_at desc)
      from (select * from public.notifications where user_id = u order by created_at desc limit 100) n), '[]')
  ) into result;
  return result;
end $$;

revoke execute on function public.set_tracking_status(text, text, text, text, timestamptz), public._work_key(text, text),
  public._isbn13(text), public._requestable(), public._book_bundle(uuid, text[]), public.search_books(text),
  public.similar_books(text), public._clear_wishlist_on_complete() from public, anon, authenticated;
grant execute on function public.search_books(text), public.similar_books(text) to authenticated;
grant execute on function public.set_tracking_status(text, text, text, text, timestamptz) to service_role;
