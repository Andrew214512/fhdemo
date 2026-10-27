-- Wormy: condition ratings and AI book summaries.
--
-- Condition ratings. Each request remembers the condition its copy was listed in. After an
-- exchange completes, the recipient says what condition the book actually arrived in. That:
--   * updates the copy on their shelf to the condition they saw,
--   * adds to that physical copy's condition history (shown without names), and
--   * builds each sender's "condition accurate" record (arrived as described or better).
--
-- Summaries. Books can carry a short AI-written summary. The book-summary function writes it
-- once per book, in its own words and from the title and author only, and everyone sees the
-- same text. A model that doesn't know the book returns nothing, and that answer is kept too.

alter table public.requests add column listed_condition public.condition_grade;
update public.requests r set listed_condition = c.condition
  from public.copies c where c.id = r.copy_id and r.listed_condition is null;

-- Snapshot the copy's condition at the moment someone asks for it.
create function public._snapshot_condition() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.listed_condition := (select condition from public.copies where id = new.copy_id);
  return new;
end $$;
create trigger requests_snapshot_condition before insert on public.requests
  for each row execute function public._snapshot_condition();

alter table public.exchanges
  add column received_condition public.condition_grade,
  add column received_condition_at timestamptz;

alter table public.books
  add column summary text check (summary is null or char_length(summary) <= 700),
  add column summary_model text,
  add column summary_at timestamptz;

update public.settings set value = value || '{"summary": {"max": 30, "seconds": 3600}}'
 where key = 'rate_limits';

-- 1 = New ... 5 = Acceptable. Lower is better.
create function public._cond_rank(p text) returns int language sql immutable as $$
  select array_position(array['new','ln','vg','good','acc'], p)
$$;

-- How often a reader's books arrived in the condition they listed, or better.
create function public._cond_record(p_user uuid, out rated int, out accurate int) language sql stable as $$
  select count(*)::int,
         (count(*) filter (where public._cond_rank(x.received_condition) <= public._cond_rank(r.listed_condition)))::int
    from public.exchanges x join public.requests r on r.id = x.request_id
   where x.sender_id = p_user and x.received_condition is not null and r.listed_condition is not null
$$;

-- Every completed trip this physical copy has made: listed as, arrived as. No names.
create function public._copy_history(p_copy uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', public._ms(x.completed_at), 'listed', r.listed_condition, 'received', x.received_condition)
           order by x.completed_at), '[]')
    from public.exchanges x join public.requests r on r.id = x.request_id
   where x.copy_id = p_copy and x.status = 'complete'
$$;

-- The recipient says what condition the book arrived in. Once, after the exchange completes.
create function public.rate_condition(p_req uuid, p_condition text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x public.exchanges := public._my_exchange(p_req, 'recipient');
  listed text := (select listed_condition from public.requests where id = p_req);
  t text := public._title((select isbn from public.copies where id = x.copy_id));
  verdict text;
begin
  if x.status <> 'complete' then raise exception 'You can rate its condition once the exchange is complete.'; end if;
  if public._cond_rank(p_condition) is null then raise exception 'Choose a condition.'; end if;
  if x.received_condition is not null then raise exception 'You already rated this book''s condition.'; end if;
  update public.exchanges set received_condition = p_condition, received_condition_at = now() where id = x.id;
  -- It's the recipient's copy now, so their shelf shows what they saw. Not if the next reader
  -- has already asked for it, though: they were promised the condition it was listed in.
  update public.copies set condition = p_condition
   where id = x.copy_id and owner_id = x.recipient_id
     and not exists (select 1 from public.requests q where q.copy_id = x.copy_id and q.status = 'pending')
     and not exists (select 1 from public.exchanges e where e.copy_id = x.copy_id
                     and e.status in ('accepted','shipped','delivered','disputed'));
  verdict := 'arrived ' || public._cond_label(p_condition) || case
    when listed is null then ''
    when public._cond_rank(p_condition) < public._cond_rank(listed) then ', better than listed'
    when p_condition = listed then ', as described'
    else '. It was listed as ' || public._cond_label(listed) end;
  perform public._log(p_req, public._name(x.recipient_id) || ' says it ' || verdict || '.');
  perform public._notify(x.sender_id, 'Condition rated',
    public._name(x.recipient_id) || ' says ' || t || ' ' || verdict || '.', jsonb_build_object('request', p_req));
end $$;

-- Server only: what the book-summary function needs, and where it saves its answer.
create function public.get_book_summary(p_isbn text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('isbn', isbn, 'title', title, 'author', author, 'year', year,
                            'summary', summary, 'checkedAt', public._ms(summary_at))
  from public.books where isbn = p_isbn
$$;

create function public.set_book_summary(p_isbn text, p_summary text, p_model text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The first summary written is the one everyone sees.
  update public.books
     set summary = nullif(left(btrim(p_summary), 700), ''), summary_model = p_model, summary_at = now()
   where isbn = p_isbn and summary is null;
  return public.get_book_summary(p_isbn);
end $$;

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
        'genre', coalesce(b.genre, 'Other'), 'cover', b.cover_url, 'summary', b.summary)) from vb b), '{}'),
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

revoke execute on function public._snapshot_condition(), public._cond_rank(text), public._cond_record(uuid),
  public._copy_history(uuid), public.rate_condition(uuid, text), public.get_book_summary(text),
  public.set_book_summary(text, text, text) from public, anon, authenticated;
grant execute on function public.rate_condition(uuid, text) to authenticated;
grant execute on function public.get_book_summary(text), public.set_book_summary(text, text, text) to service_role;
