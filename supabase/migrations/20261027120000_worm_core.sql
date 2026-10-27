-- Wormy: core database.
--
-- Security model, in one paragraph:
-- Every table has Row Level Security turned on with no policies, and the public
-- API roles (anon, authenticated) have no table privileges at all. The only way
-- in is the small set of functions granted at the bottom of this file. Each one
-- checks who is calling (auth.uid()), what they own, and what state things are
-- in, then makes its changes in a single transaction. Credits and money live in
-- append-only ledgers that can't be edited or deleted, and balances are always
-- computed from them, never stored.

set check_function_bodies = on;

-- ============================================================================
-- Reference values
-- ============================================================================

create domain public.us_state as text check (value in (
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
  'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'));

create domain public.condition_grade as text check (value in ('new','ln','vg','good','acc'));

-- ============================================================================
-- Tables
-- ============================================================================

-- One row per reader. Never deleted: deleting an account anonymizes this row so
-- the exchange and payment history stays consistent.
create table public.profiles (
  id uuid primary key,
  handle text not null unique check (handle ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  -- Path inside Wormy's own avatars bucket ("<user id>/<file>"), never a full web address,
  -- so a profile photo can't point at someone else's server.
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  city text check (city is null or char_length(city) <= 60),
  state public.us_state,
  genres text[] not null default '{}' check (genres <@ array['Literary','Sci-fi & Fantasy','Historical','Mystery','Romance','Nonfiction']),
  welcome text not null default 'locked' check (welcome in ('locked','granted','off')),
  is_admin boolean not null default false,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Private. Only its owner sees it, and the one reader who is shipping them a book
-- sees it while that exchange is waiting to ship.
create table public.addresses (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  line1 text not null check (char_length(btrim(line1)) between 1 and 100),
  line2 text check (line2 is null or char_length(line2) <= 100),
  city text not null check (char_length(btrim(city)) between 1 and 60),
  state public.us_state not null,
  zip text not null check (zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  updated_at timestamptz not null default now()
);

-- Canonical book metadata, one row per ISBN-13. Only the server (add-book
-- function) writes here, so readers can't rename other people's books.
create table public.books (
  isbn text primary key check (isbn ~ '^97[89][0-9]{10}$'),
  title text not null check (char_length(title) between 1 and 300),
  author text not null check (char_length(author) <= 300),
  year int check (year between 1400 and 2100),
  genre text,
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

-- A physical book. Ownership moves to the recipient when an exchange completes.
create table public.copies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  isbn text not null references public.books(isbn),
  condition public.condition_grade not null,
  format text not null default 'Paperback' check (format in ('Hardcover','Paperback','Mass market')),
  flags text[] not null default '{}' check (flags <@ array['Highlighting or notes','Dust jacket included','Ex-library','Signed','Smoke-free home']),
  acquired_at timestamptz not null default now(),
  removed_at timestamptz
);
create index copies_owner on public.copies(owner_id) where removed_at is null;

-- A copy that's open for requests.
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index listings_one_open_per_copy on public.listings(copy_id) where closed_at is null;
create index listings_open on public.listings(opened_at desc) where closed_at is null;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  copy_id uuid not null references public.copies(id),
  isbn text not null references public.books(isbn),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','withdrawn')),
  fee_sender_cents int not null check (fee_sender_cents between 0 and 1000),
  fee_recipient_cents int not null check (fee_recipient_cents between 0 and 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (sender_id <> recipient_id)
);
create unique index requests_one_pending_per_reader on public.requests(listing_id, recipient_id) where status = 'pending';
create index requests_sender on public.requests(sender_id);
create index requests_recipient on public.requests(recipient_id);

create table public.exchanges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests(id),
  copy_id uuid not null references public.copies(id),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  status text not null default 'accepted' check (status in ('accepted','shipped','delivered','disputed','complete','cancelled')),
  accepted_at timestamptz not null default now(),
  ship_by timestamptz not null,
  reminded_at timestamptz,
  carrier text check (carrier in ('USPS','UPS','FedEx')),
  tracking text check (tracking ~ '^[A-Z0-9]{8,40}$'),
  tracker_id text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  dispute_reason text,
  outcome text
);
-- A copy can only be in one exchange at a time.
create unique index exchanges_one_active_per_copy on public.exchanges(copy_id) where status in ('accepted','shipped','delivered','disputed');
-- A tracking number can only prove one shipment.
create unique index exchanges_tracking_once on public.exchanges(carrier, tracking) where tracking is not null;
create unique index exchanges_tracker on public.exchanges(tracker_id) where tracker_id is not null;

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id),
  at timestamptz not null default now(),
  text text not null
);
create index request_events_request on public.request_events(request_id);

-- Append-only credit ledger. Each row moves exactly one credit.
create table public.credit_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  type text not null check (type in ('grant','earn','reserve','release','spend','reverse')),
  request_id uuid references public.requests(id),
  note text,
  created_at timestamptz not null default now(),
  check ((type = 'grant') = (request_id is null))
);
-- No duplicate entries for the same request, and a reservation settles exactly once.
create unique index credit_once_per_request on public.credit_entries(user_id, request_id, type) where request_id is not null;
create unique index credit_settle_once on public.credit_entries(user_id, request_id) where type in ('release','spend');
create unique index credit_one_welcome on public.credit_entries(user_id) where type = 'grant';
create index credit_user on public.credit_entries(user_id);

-- Append-only money ledger, in cents. Card details never appear here: Stripe
-- holds them. card_fingerprint is Stripe's one-way ID for a card number, used
-- only to stop one card from claiming many welcome credits.
create table public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('topup','fee','refund')),
  amount_cents int not null check (amount_cents > 0),
  request_id uuid references public.requests(id),
  stripe_session_id text unique,
  stripe_payment_intent text,
  card_fingerprint text,
  note text,
  created_at timestamptz not null default now()
);
create unique index payments_fee_once on public.payments(user_id, request_id) where kind = 'fee';
create index payments_user on public.payments(user_id);
create index payments_intent on public.payments(stripe_payment_intent) where stripe_payment_intent is not null;

create table public.wishlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  isbn text not null references public.books(isbn),
  created_at timestamptz not null default now(),
  primary key (user_id, isbn)
);
create index wishlist_isbn on public.wishlist(isbn);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  link jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications(user_id, created_at desc);

create table public.ratings (
  request_id uuid not null references public.requests(id),
  rater_id uuid not null references public.profiles(id),
  ratee_id uuid not null references public.profiles(id),
  stars int not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (request_id, rater_id)
);
create index ratings_ratee on public.ratings(ratee_id);

create table public.strikes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  request_id uuid references public.requests(id),
  reason text not null,
  created_at timestamptz not null default now()
);
create index strikes_user on public.strikes(user_id, created_at desc);

create table public.settings (
  key text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values
  ('pricing', '{"sender_cents": 100, "recipient_cents": 100}'),
  ('topup_amounts', '[500, 1000, 2000]'),
  ('limits', '{"open_requests": 5, "copies": 500}'),
  ('welcome', '{"enabled": true, "listings": 3}'),
  -- Per-reader limits on the server functions that cost money or call outside services.
  ('rate_limits', '{"add-book": {"max": 200, "seconds": 3600}, "checkout": {"max": 10, "seconds": 3600}, "tracking": {"max": 30, "seconds": 3600}}');

create table public.rate_hits (
  user_id uuid not null,
  bucket text not null,
  at timestamptz not null default now()
);
create index rate_hits_lookup on public.rate_hits(user_id, bucket, at desc);

-- Ledgers can't be edited or deleted, by anyone, including the server.
create function public._immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Ledger records cannot be changed or deleted.';
end $$;
create trigger credit_entries_immutable before update or delete on public.credit_entries
  for each row execute function public._immutable();
create trigger payments_immutable before update or delete on public.payments
  for each row execute function public._immutable();

-- ============================================================================
-- Lock the tables: no direct access from the public API, ever.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['profiles','addresses','books','copies','listings','requests','exchanges',
    'request_events','credit_entries','payments','wishlist','notifications','ratings','strikes','settings','rate_hits']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================================
-- Internal helpers (not callable through the API)
-- ============================================================================

create function public._ms(t timestamptz) returns bigint language sql immutable as $$
  select (extract(epoch from t) * 1000)::bigint
$$;

create function public._uid() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then
    raise exception 'Please sign in.';
  end if;
  return u;
end $$;

-- Signed in AND has an active profile.
create function public._me() returns uuid language plpgsql stable as $$
declare u uuid := public._uid();
begin
  if not exists (select 1 from public.profiles where id = u and deleted_at is null) then
    raise exception 'Finish setting up your profile first.';
  end if;
  return u;
end $$;

create function public._setting(p_key text) returns jsonb language sql stable as $$
  select value from public.settings where key = p_key
$$;

create function public._title(p_isbn text) returns text language sql stable as $$
  select title from public.books where isbn = p_isbn
$$;

create function public._name(p_user uuid) returns text language sql stable as $$
  select split_part(display_name, ' ', 1) from public.profiles where id = p_user
$$;

create function public._cond_label(p text) returns text language sql immutable as $$
  select case p when 'new' then 'New' when 'ln' then 'Like New' when 'vg' then 'Very Good'
                when 'good' then 'Good' when 'acc' then 'Acceptable' end
$$;

create function public._money(p_cents int) returns text language sql immutable as $$
  select '$' || to_char(p_cents / 100.0, 'FM999990.00')
$$;

create function public._log(p_req uuid, p_text text) returns void language sql as $$
  insert into public.request_events (request_id, text) values (p_req, p_text)
$$;

create function public._notify(p_user uuid, p_title text, p_body text, p_link jsonb default null) returns void language sql as $$
  insert into public.notifications (user_id, title, body, link) values (p_user, p_title, p_body, p_link)
$$;

create function public._balances(p_user uuid, out available int, out reserved int) language sql stable as $$
  select
    coalesce(sum(case type when 'grant' then 1 when 'earn' then 1 when 'release' then 1
                           when 'reserve' then -1 when 'reverse' then -1 else 0 end), 0)::int,
    coalesce(sum(case type when 'reserve' then 1 when 'release' then -1 when 'spend' then -1 else 0 end), 0)::int
  from public.credit_entries where user_id = p_user
$$;

-- Adds one ledger entry if the rules allow it. Returns false (and changes nothing)
-- when the entry would be a duplicate or has nothing to settle.
create function public._post(p_user uuid, p_type text, p_req uuid, p_note text) returns boolean language plpgsql as $$
declare inserted int;
begin
  if p_type in ('release','spend') and not exists (
    select 1 from public.credit_entries where user_id = p_user and request_id = p_req and type = 'reserve') then
    return false;
  end if;
  if p_type = 'reverse' and not exists (
    select 1 from public.credit_entries where user_id = p_user and request_id = p_req and type = 'earn') then
    return false;
  end if;
  insert into public.credit_entries (user_id, type, request_id, note)
    values (p_user, p_type, p_req, p_note)
    on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

create function public._fee_balance(p_user uuid) returns int language sql stable as $$
  select coalesce(sum(case kind when 'topup' then amount_cents else -amount_cents end), 0)::int
  from public.payments where user_id = p_user
$$;

-- Fees promised to open requests and exchanges, so the same balance can't be promised twice.
create function public._fees_held(p_user uuid) returns int language sql stable as $$
  select coalesce(sum(case when r.recipient_id = p_user then r.fee_recipient_cents else r.fee_sender_cents end), 0)::int
  from public.requests r
  left join public.exchanges x on x.request_id = r.id
  where (r.recipient_id = p_user and (r.status = 'pending' or x.status in ('accepted','shipped','delivered','disputed')))
     or (r.sender_id = p_user and x.status in ('accepted','shipped','delivered','disputed'))
$$;

create function public._fee_free(p_user uuid) returns int language sql stable as $$
  select public._fee_balance(p_user) - public._fees_held(p_user)
$$;

create function public._strike_count(p_user uuid) returns int language sql stable as $$
  select count(*)::int from public.strikes where user_id = p_user and created_at > now() - interval '6 months'
$$;

create function public._paused(p_user uuid) returns boolean language sql stable as $$
  select public._strike_count(p_user) >= 3
$$;

create function public._strike(p_user uuid, p_req uuid, p_reason text) returns void language plpgsql as $$
begin
  insert into public.strikes (user_id, request_id, reason) values (p_user, p_req, p_reason);
  if public._strike_count(p_user) = 3 then
    perform public._notify(p_user, 'Requests are paused',
      'Your account has 3 strikes in 6 months, so requests and new listings are paused. Contact support if this is a mistake.');
  end if;
end $$;

-- Welcome credit: one per reader, after 3 available listings and a first top-up
-- from a card that hasn't already unlocked a welcome credit on another account.
create function public._check_welcome(p_user uuid) returns void language plpgsql as $$
declare cfg jsonb := public._setting('welcome');
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) then return; end if;
  if (select welcome from public.profiles where id = p_user) <> 'locked' then return; end if;
  if (select count(*) from public.listings l join public.copies c on c.id = l.copy_id
      where c.owner_id = p_user and l.closed_at is null and c.removed_at is null)
     < coalesce((cfg ->> 'listings')::int, 3) then
    return;
  end if;
  if not exists (
    select 1 from public.payments p
    where p.user_id = p_user and p.kind = 'topup'
      and (p.card_fingerprint is null or not exists (
        select 1 from public.payments q join public.profiles pr on pr.id = q.user_id
        where q.card_fingerprint = p.card_fingerprint and q.user_id <> p_user and pr.welcome = 'granted'))) then
    return;
  end if;
  if public._post(p_user, 'grant', null, 'Welcome credit') then
    update public.profiles set welcome = 'granted' where id = p_user;
    perform public._notify(p_user, 'Your welcome credit is ready', 'Spend it on any available book.', '{"wallet": true, "welcome": true}');
  end if;
end $$;

create function public._close_request(p_req uuid, p_status text, p_text text) returns boolean language plpgsql as $$
declare r public.requests;
begin
  update public.requests set status = p_status, decided_at = now()
    where id = p_req and status = 'pending'
    returning * into r;
  if r.id is null then return false; end if;
  perform public._log(r.id, p_text);
  perform public._post(r.recipient_id, 'release', r.id, 'Credit returned: ' || public._title(r.isbn));
  return true;
end $$;

-- Opens a listing and tells readers who wished for this book (once a day per book).
create function public._open_listing(p_copy uuid) returns uuid language plpgsql as $$
declare
  c public.copies;
  l uuid;
begin
  select * into c from public.copies where id = p_copy;
  insert into public.listings (copy_id) values (p_copy) on conflict do nothing returning id into l;
  if l is null then return null; end if;
  insert into public.notifications (user_id, title, body, link)
  select w.user_id,
         public._title(c.isbn) || ' is available',
         public._name(c.owner_id) || ' listed a ' || public._cond_label(c.condition) || ' copy. It''s on your wishlist.',
         jsonb_build_object('listing', l, 'isbn', c.isbn)
  from public.wishlist w
  join public.profiles p on p.id = w.user_id and p.deleted_at is null
  where w.isbn = c.isbn and w.user_id <> c.owner_id
    and not exists (select 1 from public.notifications n
                    where n.user_id = w.user_id and n.link ->> 'isbn' = c.isbn
                      and n.created_at > now() - interval '1 day');
  return l;
end $$;

create function public._close_listing(p_copy uuid, p_reason text) returns void language plpgsql as $$
declare r record;
begin
  update public.listings set closed_at = now() where copy_id = p_copy and closed_at is null;
  for r in select id, recipient_id, isbn from public.requests where copy_id = p_copy and status = 'pending' for update loop
    if public._close_request(r.id, 'declined', p_reason) then
      perform public._notify(r.recipient_id, public._title(r.isbn) || ' is no longer available',
        'Your credit is back in your wallet.', jsonb_build_object('request', r.id));
    end if;
  end loop;
end $$;

-- Settles an exchange exactly once: spend the recipient's credit, award the
-- sender's credit, capture both fees, hand the copy to its new reader.
create function public._complete(p_ex uuid, p_how text) returns boolean language plpgsql as $$
declare
  x public.exchanges;
  r public.requests;
  t text;
begin
  update public.exchanges
     set status = 'complete', completed_at = now(), delivered_at = coalesce(delivered_at, now())
   where id = p_ex and status in ('shipped','delivered','disputed')
   returning * into x;
  if x.id is null then return false; end if;
  select * into r from public.requests where id = x.request_id;
  t := public._title(r.isbn);
  perform public._log(r.id, p_how);
  perform public._post(x.recipient_id, 'spend', r.id, 'Received ' || t || ' from ' || public._name(x.sender_id));
  perform public._post(x.sender_id, 'earn', r.id, 'Sent ' || t || ' to ' || public._name(x.recipient_id));
  if r.fee_recipient_cents > 0 then
    insert into public.payments (user_id, kind, amount_cents, request_id, note)
      values (x.recipient_id, 'fee', r.fee_recipient_cents, r.id, 'Fee for receiving ' || t)
      on conflict do nothing;
  end if;
  if r.fee_sender_cents > 0 then
    insert into public.payments (user_id, kind, amount_cents, request_id, note)
      values (x.sender_id, 'fee', r.fee_sender_cents, r.id, 'Fee for sending ' || t)
      on conflict do nothing;
  end if;
  update public.listings set closed_at = now() where copy_id = x.copy_id and closed_at is null;
  update public.copies set owner_id = x.recipient_id, acquired_at = now() where id = x.copy_id;
  delete from public.wishlist where user_id = x.recipient_id and isbn = r.isbn;
  perform public._notify(x.sender_id, 'You earned 1 credit',
    public._name(x.recipient_id) || ' confirmed ' || t || ' arrived.', jsonb_build_object('request', r.id, 'earned', true));
  return true;
end $$;

create function public._cancel_exchange(p_ex uuid, p_text text, p_outcome text) returns boolean language plpgsql as $$
declare x public.exchanges;
begin
  update public.exchanges set status = 'cancelled', outcome = p_outcome
   where id = p_ex and status in ('accepted','shipped','delivered','disputed')
   returning * into x;
  if x.id is null then return false; end if;
  perform public._log(x.request_id, p_text);
  perform public._post(x.recipient_id, 'release', x.request_id, 'Credit returned: ' || public._title((select isbn from public.copies where id = x.copy_id)));
  return true;
end $$;

-- Finds an exchange the caller takes part in, locked for update.
create function public._my_exchange(p_req uuid, p_role text) returns public.exchanges language plpgsql as $$
declare
  u uuid := public._me();
  x public.exchanges;
begin
  select * into x from public.exchanges where request_id = p_req for update;
  if x.id is null
     or (p_role = 'sender' and x.sender_id <> u)
     or (p_role = 'recipient' and x.recipient_id <> u)
     or (p_role = 'either' and u not in (x.sender_id, x.recipient_id)) then
    raise exception 'We couldn''t find that exchange.';
  end if;
  return x;
end $$;

create function public._normalize_tracking(p_carrier text, p_tracking text) returns text language plpgsql immutable as $$
declare t text := upper(regexp_replace(coalesce(p_tracking, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if p_carrier = 'USPS' and t ~ '^([0-9]{20,22}|[0-9]{26}|[A-Z]{2}[0-9]{9}US)$' then return t; end if;
  if p_carrier = 'UPS' and t ~ '^1Z[0-9A-Z]{16}$' then return t; end if;
  if p_carrier = 'FedEx' and t ~ '^([0-9]{12}|[0-9]{15}|[0-9]{20}|[0-9]{22})$' then return t; end if;
  return null;
end $$;

-- ============================================================================
-- Reader API (granted to signed-in readers)
-- ============================================================================

-- Everything the app needs to draw its screens, limited to what this reader may see.
create function public.get_state() returns jsonb
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
        'ratings', (select count(*) from public.ratings where ratee_id = p.id)))
      from public.profiles p where p.id in (select id from vu) and p.id <> u), '{}'),
    'books', coalesce((select jsonb_object_agg(b.isbn, jsonb_build_object(
        'id', b.isbn, 'isbn', b.isbn, 'title', b.title, 'author', b.author, 'year', b.year,
        'genre', coalesce(b.genre, 'Other'), 'cover', b.cover_url)) from vb b), '{}'),
    'copies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'owner', c.owner_id, 'bookId', c.isbn, 'cond', c.condition, 'format', c.format,
        'flags', to_jsonb(c.flags), 'addedAt', public._ms(c.acquired_at))) from vc c), '[]'),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'copyId', l.copy_id, 'openedAt', public._ms(l.opened_at), 'closedAt', public._ms(l.closed_at))) from vl l), '[]'),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'listingId', r.listing_id, 'copyId', r.copy_id, 'bookId', r.isbn,
        'sender', r.sender_id, 'recipient', r.recipient_id, 'at', public._ms(r.created_at), 'status', r.status,
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

create function public.handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(btrim(p_handle)) ~ '^[a-z0-9_.]{3,20}$'
     and lower(btrim(p_handle)) not in ('admin','worm','support','help','official','staff','moderator','root','system')
     and not exists (select 1 from public.profiles where handle = lower(btrim(p_handle)) and id <> auth.uid())
$$;

create function public.save_profile(p_handle text, p_display_name text, p_city text, p_state text,
                                    p_genres text[] default '{}', p_avatar_path text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._uid();
  h text := lower(btrim(coalesce(p_handle, '')));
begin
  if exists (select 1 from public.profiles where id = u and deleted_at is not null) then
    raise exception 'This account was deleted.';
  end if;
  if h !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Handles are 3 to 20 characters: letters, numbers, dots and underscores.';
  end if;
  if not public.handle_available(h) then
    raise exception 'That handle is taken. Try another.';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60 then
    raise exception 'Add your name (up to 60 characters).';
  end if;
  if p_state is not null and p_state <> '' and not (p_state = any(array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'])) then
    raise exception 'Wormy ships within the US only. Choose a US state.';
  end if;
  -- Photos must be a file in this reader's own folder of Wormy's storage.
  if p_avatar_path is not null and not starts_with(p_avatar_path, u::text || '/') then
    raise exception 'Upload your photo again.';
  end if;
  insert into public.profiles (id, handle, display_name, city, state, genres, avatar_path)
  values (u, h, btrim(p_display_name), nullif(btrim(p_city), ''), nullif(p_state, ''), coalesce(p_genres, '{}'), p_avatar_path)
  on conflict (id) do update set
    handle = excluded.handle,
    display_name = excluded.display_name,
    city = excluded.city,
    state = excluded.state,
    genres = excluded.genres,
    avatar_path = coalesce(excluded.avatar_path, public.profiles.avatar_path);
exception
  when unique_violation then raise exception 'That handle is taken. Try another.';
  when check_violation then raise exception 'Some profile details aren''t valid. Check your name, city and genres.';
end $$;

create function public.save_address(p_name text, p_line1 text, p_line2 text, p_city text, p_state text, p_zip text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if btrim(coalesce(p_zip, '')) !~ '^[0-9]{5}(-[0-9]{4})?$' then raise exception 'Enter a 5-digit US ZIP code.'; end if;
  insert into public.addresses (user_id, name, line1, line2, city, state, zip, updated_at)
  values (u, btrim(p_name), btrim(p_line1), nullif(btrim(coalesce(p_line2, '')), ''), btrim(p_city), p_state, btrim(p_zip), now())
  on conflict (user_id) do update set name = excluded.name, line1 = excluded.line1, line2 = excluded.line2,
    city = excluded.city, state = excluded.state, zip = excluded.zip, updated_at = now();
exception
  when check_violation then raise exception 'Check the address: name, street, city, a US state and ZIP are all required.';
end $$;

create function public.toggle_wish(p_isbn text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if not exists (select 1 from public.books where isbn = p_isbn) then raise exception 'We couldn''t find that book.'; end if;
  delete from public.wishlist where user_id = u and isbn = p_isbn;
  if found then return false; end if;
  if (select count(*) from public.wishlist where user_id = u) >= 200 then raise exception 'Your wishlist is full (200 books).'; end if;
  insert into public.wishlist (user_id, isbn) values (u, p_isbn);
  return true;
end $$;

create function public.add_copy(p_isbn text, p_condition text, p_format text default 'Paperback') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._me();
  c uuid;
begin
  if not exists (select 1 from public.books where isbn = p_isbn) then
    raise exception 'We couldn''t find that book. Scan it again or search by title.';
  end if;
  if p_condition not in ('new','ln','vg','good','acc') then raise exception 'Choose a condition.'; end if;
  if (select count(*) from public.copies where owner_id = u and removed_at is null)
     >= coalesce((public._setting('limits') ->> 'copies')::int, 500) then
    raise exception 'Your shelf is full. Remove a few books first.';
  end if;
  insert into public.copies (owner_id, isbn, condition, format)
    values (u, p_isbn, p_condition, coalesce(nullif(p_format, ''), 'Paperback'))
    returning id into c;
  if not public._paused(u) then
    perform public._open_listing(c);
    perform public._check_welcome(u);
  end if;
  return c;
end $$;

create function public.update_copy(p_copy uuid, p_condition text, p_format text, p_flags text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if not exists (select 1 from public.copies where id = p_copy and owner_id = u and removed_at is null) then
    raise exception 'We couldn''t find that book on your shelf.';
  end if;
  if exists (select 1 from public.exchanges where copy_id = p_copy and status in ('accepted','shipped','delivered','disputed')) then
    raise exception 'This copy is in an exchange, so it can''t be changed right now.';
  end if;
  update public.copies set condition = p_condition, format = p_format, flags = coalesce(p_flags, '{}') where id = p_copy;
exception
  when check_violation then raise exception 'Choose a valid condition, format and notes.';
end $$;

create function public.set_available(p_copy uuid, p_available boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if not exists (select 1 from public.copies where id = p_copy and owner_id = u and removed_at is null) then
    raise exception 'We couldn''t find that book on your shelf.';
  end if;
  if exists (select 1 from public.exchanges where copy_id = p_copy and status in ('accepted','shipped','delivered','disputed')) then
    raise exception 'This copy is in an exchange, so it can''t be changed right now.';
  end if;
  if p_available then
    if public._paused(u) then raise exception 'New listings are paused on your account after 3 missed ship windows.'; end if;
    perform public._open_listing(p_copy);
    perform public._check_welcome(u);
  else
    perform public._close_listing(p_copy, 'Declined: the owner made this copy unavailable.');
  end if;
end $$;

create function public.remove_copy(p_copy uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if not exists (select 1 from public.copies where id = p_copy and owner_id = u and removed_at is null) then
    raise exception 'We couldn''t find that book on your shelf.';
  end if;
  if exists (select 1 from public.exchanges where copy_id = p_copy and status in ('accepted','shipped','delivered','disputed')) then
    raise exception 'This copy is in an exchange, so it can''t be removed right now.';
  end if;
  perform public._close_listing(p_copy, 'Declined: the owner removed this copy.');
  update public.copies set removed_at = now() where id = p_copy;
end $$;

create function public.request_book(p_listing uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._me();
  l public.listings;
  c public.copies;
  pricing jsonb := public._setting('pricing');
  fee_r int;
  fee_s int;
  r uuid;
begin
  -- One request at a time per reader, so two taps can't spend the same credit twice.
  perform 1 from public.profiles where id = u for update;

  if public._paused(u) then
    raise exception 'Requests are paused on your account after 3 missed ship windows. Contact support if this is a mistake.';
  end if;
  if not exists (select 1 from public.addresses where user_id = u) then
    raise exception 'Add a US shipping address first.';
  end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.closed_at is not null then raise exception 'This book is no longer available.'; end if;
  select * into c from public.copies where id = l.copy_id;
  if c.removed_at is not null or exists (select 1 from public.profiles where id = c.owner_id and deleted_at is not null) then
    raise exception 'This book is no longer available.';
  end if;
  if c.owner_id = u then raise exception 'That''s your own book.'; end if;
  if exists (select 1 from public.exchanges where copy_id = c.id and status in ('accepted','shipped','delivered','disputed')) then
    raise exception 'Someone else is getting this copy right now.';
  end if;
  if exists (select 1 from public.requests where listing_id = l.id and recipient_id = u and status = 'pending') then
    raise exception 'You already requested this copy.';
  end if;
  if (select count(*) from public.requests rq left join public.exchanges x on x.request_id = rq.id
      where rq.recipient_id = u and (rq.status = 'pending' or x.status in ('accepted','shipped','delivered','disputed')))
     >= coalesce((public._setting('limits') ->> 'open_requests')::int, 5) then
    raise exception 'You can have 5 open requests at a time. Wait for one to finish.';
  end if;
  if (public._balances(u)).available < 1 then
    raise exception 'You need 1 credit. Send a book from your shelf to earn one.';
  end if;
  fee_r := (pricing ->> 'recipient_cents')::int;
  fee_s := (pricing ->> 'sender_cents')::int;
  if public._fee_free(u) < fee_r then
    raise exception 'Add to your fee balance to cover the % fee.', public._money(fee_r);
  end if;

  insert into public.requests (listing_id, copy_id, isbn, sender_id, recipient_id, fee_sender_cents, fee_recipient_cents)
    values (l.id, c.id, c.isbn, c.owner_id, u, fee_s, fee_r)
    returning id into r;
  perform public._post(u, 'reserve', r, 'Requested ' || public._title(c.isbn));
  perform public._log(r, public._name(u) || ' requested ' || public._title(c.isbn) || '. 1 credit reserved.');
  perform public._notify(c.owner_id, public._name(u) || ' requested ' || public._title(c.isbn),
    'Accept within 48 hours, then ship within 3 days. You earn 1 credit when it arrives.', jsonb_build_object('request', r));
  return r;
end $$;

create function public.withdraw_request(p_req uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public._me();
begin
  if not exists (select 1 from public.requests where id = p_req and recipient_id = u) then
    raise exception 'We couldn''t find that request.';
  end if;
  if not public._close_request(p_req, 'withdrawn', public._name(u) || ' cancelled the request. Their credit was returned.') then
    raise exception 'This request can''t be cancelled anymore.';
  end if;
end $$;

create function public.decline_request(p_req uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._me();
  r public.requests;
begin
  select * into r from public.requests where id = p_req and sender_id = u;
  if r.id is null then raise exception 'We couldn''t find that request.'; end if;
  if not public._close_request(p_req, 'declined', 'Declined. The reader''s credit was returned.') then
    raise exception 'This request is no longer open.';
  end if;
  perform public._notify(r.recipient_id, public._name(u) || ' can''t send ' || public._title(r.isbn),
    'Your credit is back in your wallet.', jsonb_build_object('request', r.id));
end $$;

create function public.accept_request(p_req uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._me();
  r public.requests;
  x uuid;
  o record;
begin
  perform 1 from public.profiles where id = u for update;
  select * into r from public.requests where id = p_req for update;
  if r.id is null or r.sender_id <> u then raise exception 'We couldn''t find that request.'; end if;
  if r.status <> 'pending' then raise exception 'This request is no longer open.'; end if;
  if not exists (select 1 from public.copies where id = r.copy_id and owner_id = u and removed_at is null) then
    raise exception 'This copy is no longer on your shelf.';
  end if;
  if public._fee_free(u) < r.fee_sender_cents then
    raise exception 'Add to your fee balance to cover the % sending fee.', public._money(r.fee_sender_cents);
  end if;
  begin
    insert into public.exchanges (request_id, copy_id, sender_id, recipient_id, ship_by)
      values (r.id, r.copy_id, r.sender_id, r.recipient_id, now() + interval '3 days')
      returning id into x;
  exception when unique_violation then
    raise exception 'This copy is already in another exchange.';
  end;
  update public.requests set status = 'accepted', decided_at = now() where id = r.id;
  perform public._log(r.id, public._name(u) || ' accepted. Ships by ' || to_char(now() + interval '3 days', 'Dy, Mon FMDD') || '.');
  perform public._notify(r.recipient_id, public._name(u) || ' accepted your request',
    public._title(r.isbn) || ' ships within 3 days.', jsonb_build_object('request', r.id));
  -- One copy, one exchange: everyone else waiting on this copy gets their credit back.
  for o in select id, recipient_id from public.requests where copy_id = r.copy_id and status = 'pending' and id <> r.id loop
    if public._close_request(o.id, 'declined', 'Declined automatically: this copy went to another reader.') then
      perform public._notify(o.recipient_id, public._title(r.isbn) || ' went to someone else',
        'Your credit is back in your wallet.', jsonb_build_object('request', o.id));
    end if;
  end loop;
  return x;
end $$;

create function public.ship_exchange(p_req uuid, p_carrier text, p_tracking text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x public.exchanges := public._my_exchange(p_req, 'sender');
  t text := public._normalize_tracking(p_carrier, p_tracking);
begin
  if x.status <> 'accepted' then raise exception 'This exchange isn''t waiting to ship.'; end if;
  if p_carrier not in ('USPS','UPS','FedEx') then raise exception 'Choose USPS, UPS or FedEx.'; end if;
  if t is null then raise exception 'That doesn''t look like a % tracking number. Check your receipt.', p_carrier; end if;
  begin
    update public.exchanges set status = 'shipped', carrier = p_carrier, tracking = t, shipped_at = now() where id = x.id;
  exception when unique_violation then
    raise exception 'That tracking number is already used on another exchange.';
  end;
  perform public._log(p_req, public._name(x.sender_id) || ' added ' || p_carrier || ' tracking ' || t || '.');
  perform public._notify(x.recipient_id, public._title((select isbn from public.copies where id = x.copy_id)) || ' is on its way',
    public._name(x.sender_id) || ' shipped it with ' || p_carrier || '.', jsonb_build_object('request', p_req));
end $$;

-- The recipient has the book in hand. Works from "shipped" too, so exchanges
-- don't stall when a carrier's tracking never updates.
create function public.confirm_received(p_req uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.exchanges := public._my_exchange(p_req, 'recipient');
begin
  if x.status not in ('shipped','delivered') then raise exception 'This book isn''t on its way yet.'; end if;
  perform public._complete(x.id, public._name(x.recipient_id) || ' confirmed ' || public._title((select isbn from public.copies where id = x.copy_id)) || ' arrived and matches the listing.');
end $$;

create function public.report_problem(p_req uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.exchanges := public._my_exchange(p_req, 'recipient');
begin
  if x.status not in ('shipped','delivered') then raise exception 'You can report a problem once the book is on its way.'; end if;
  if p_reason not in ('Condition is worse than listed','Wrong book or edition','Damaged in the mail','Says delivered, but it isn''t here') then
    raise exception 'Choose what went wrong.';
  end if;
  update public.exchanges set status = 'disputed', dispute_reason = p_reason where id = x.id;
  perform public._log(p_req, 'Problem reported: ' || p_reason || '. Credits on hold until support decides.');
  perform public._notify(x.sender_id, 'A problem was reported',
    public._name(x.recipient_id) || ' reported: ' || p_reason || '. Support will be in touch.', jsonb_build_object('request', p_req));
  insert into public.notifications (user_id, title, body, link)
    select id, 'Dispute to review', p_reason, jsonb_build_object('request', p_req) from public.profiles where is_admin and deleted_at is null;
end $$;

create function public.rate_exchange(p_req uuid, p_stars int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._me();
  x public.exchanges := public._my_exchange(p_req, 'either');
begin
  if x.status <> 'complete' then raise exception 'You can rate once the exchange is complete.'; end if;
  if p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars.'; end if;
  insert into public.ratings (request_id, rater_id, ratee_id, stars)
    values (p_req, u, case when x.sender_id = u then x.recipient_id else x.sender_id end, p_stars)
    on conflict do nothing;
  if not found then raise exception 'You already rated this exchange.'; end if;
  perform public._log(p_req, public._name(u) || ' left a rating.');
end $$;

create function public.mark_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set read_at = now()
  where user_id = public._uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Step one of deleting an account (the delete-account function then removes the
-- sign-in itself). Open exchanges have to finish first so nobody loses a book.
create function public.delete_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public._uid();
  r record;
begin
  if exists (select 1 from public.exchanges where (sender_id = u or recipient_id = u)
             and status in ('accepted','shipped','delivered','disputed')) then
    raise exception 'Finish your open exchanges before deleting your account.';
  end if;
  for r in select id from public.requests where recipient_id = u and status = 'pending' loop
    perform public._close_request(r.id, 'withdrawn', 'Withdrawn: the reader deleted their account.');
  end loop;
  for r in select id from public.copies where owner_id = u and removed_at is null loop
    perform public._close_listing(r.id, 'Declined: the owner deleted their account.');
    update public.copies set removed_at = now() where id = r.id;
  end loop;
  delete from public.addresses where user_id = u;
  delete from public.wishlist where user_id = u;
  delete from public.notifications where user_id = u;
  update public.profiles set
    handle = 'deleted_' || substr(md5(u::text), 1, 10),
    display_name = 'Deleted reader', avatar_path = null, city = null, state = null,
    genres = '{}', stripe_customer_id = null, deleted_at = now()
  where id = u;
end $$;

-- Admins (profiles.is_admin) settle reported problems.
create function public.resolve_dispute(p_req uuid, p_upheld boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x public.exchanges;
  t text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'Only Wormy support can do that.';
  end if;
  select * into x from public.exchanges where request_id = p_req and status = 'disputed' for update;
  if x.id is null then raise exception 'No open dispute for that exchange.'; end if;
  t := public._title((select isbn from public.copies where id = x.copy_id));
  if p_upheld then
    perform public._cancel_exchange(x.id, 'Support decided for the recipient.' || coalesce(' ' || p_note, ''),
      'Support agreed the book didn''t match the listing. The recipient''s credit was returned and the sender earned nothing.');
    perform public._strike(x.sender_id, p_req, 'Book did not match listing');
    -- The book is with the recipient now and out of circulation.
    update public.listings set closed_at = now() where copy_id = x.copy_id and closed_at is null;
    update public.copies set removed_at = now() where id = x.copy_id;
    perform public._notify(x.recipient_id, 'Problem resolved', 'Your credit is back and nothing was charged.', jsonb_build_object('request', p_req));
    perform public._notify(x.sender_id, 'Problem resolved', 'Support found ' || t || ' didn''t match its listing. No credit was earned and your account got a strike.', jsonb_build_object('request', p_req));
  else
    perform public._complete(x.id, 'Support found the book matched its listing. Exchange complete.' || coalesce(' ' || p_note, ''));
    perform public._notify(x.recipient_id, 'Problem resolved', 'Support found ' || t || ' matched its listing. The exchange is complete.', jsonb_build_object('request', p_req));
  end if;
end $$;

-- ============================================================================
-- Server-only API (granted to the service role used by Wormy's edge functions)
-- ============================================================================

create function public.app_config() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'senderCents', (public._setting('pricing') ->> 'sender_cents')::int,
    'recipientCents', (public._setting('pricing') ->> 'recipient_cents')::int,
    'topupAmounts', public._setting('topup_amounts'))
$$;

create function public.get_book(p_isbn text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', isbn, 'isbn', isbn, 'title', title, 'author', author, 'year', year,
                            'genre', coalesce(genre, 'Other'), 'cover', cover_url)
  from public.books where isbn = p_isbn
$$;

create function public.upsert_book(p_isbn text, p_title text, p_author text, p_year int,
                                   p_genre text, p_cover_url text, p_source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.books (isbn, title, author, year, genre, cover_url, source)
  values (p_isbn, left(btrim(p_title), 300), left(coalesce(btrim(p_author), 'Unknown author'), 300),
          case when p_year between 1400 and 2100 then p_year end, p_genre,
          case when p_cover_url ~ '^https://' then p_cover_url end, p_source)
  on conflict (isbn) do nothing;
  return (select jsonb_build_object('id', isbn, 'isbn', isbn, 'title', title, 'author', author, 'year', year,
                                    'genre', coalesce(genre, 'Other'), 'cover', cover_url)
          from public.books where isbn = p_isbn);
end $$;

create function public.stripe_customer_for(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select stripe_customer_id from public.profiles where id = p_user and deleted_at is null
$$;

create function public.set_stripe_customer(p_user uuid, p_customer text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set stripe_customer_id = p_customer where id = p_user and stripe_customer_id is null
$$;

-- Called by the Stripe webhook after a verified, paid Checkout Session.
-- Safe to call twice for the same session.
create function public.credit_topup(p_user uuid, p_cents int, p_session text, p_payment_intent text, p_fingerprint text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare inserted int;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown reader %', p_user;
  end if;
  if not (public._setting('topup_amounts') @> to_jsonb(p_cents)) then
    raise exception 'Unexpected top-up amount %', p_cents;
  end if;
  insert into public.payments (user_id, kind, amount_cents, stripe_session_id, stripe_payment_intent, card_fingerprint, note)
    values (p_user, 'topup', p_cents, p_session, p_payment_intent, p_fingerprint, 'Added to fee balance')
    on conflict (stripe_session_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    perform public._notify(p_user, public._money(p_cents) || ' added to your fee balance', 'Thanks. Fees are only taken when a book arrives.', '{"wallet": true}');
    perform public._check_welcome(p_user);
  end if;
  return inserted = 1;
end $$;

-- Called by the Stripe webhook when a top-up is refunded. amount_refunded is
-- Stripe's running total for the charge, so repeat events record only the difference.
create function public.record_refund(p_payment_intent text, p_refunded_total int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.payments;
  already int;
begin
  select * into p from public.payments where stripe_payment_intent = p_payment_intent and kind = 'topup';
  if p.id is null then return; end if;
  select coalesce(sum(amount_cents), 0) into already from public.payments
    where stripe_payment_intent = p_payment_intent and kind = 'refund';
  if p_refunded_total > already then
    insert into public.payments (user_id, kind, amount_cents, stripe_payment_intent, note)
      values (p.user_id, 'refund', least(p_refunded_total, p.amount_cents) - already, p_payment_intent, 'Refunded to your card');
  end if;
end $$;

-- Edge functions call this before doing anything costly. Returns false once a
-- reader has used up a bucket's allowance (settings.rate_limits) for the window.
create function public.rate_limit(p_user uuid, p_bucket text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._setting('rate_limits') -> p_bucket;
  n int;
begin
  if cfg is null then raise exception 'Unknown rate limit %', p_bucket; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':' || p_bucket));
  select count(*) into n from public.rate_hits
    where user_id = p_user and bucket = p_bucket and at > now() - make_interval(secs => (cfg ->> 'seconds')::int);
  if n >= (cfg ->> 'max')::int then return false; end if;
  insert into public.rate_hits (user_id, bucket) values (p_user, p_bucket);
  delete from public.rate_hits where user_id = p_user and bucket = p_bucket and at < now() - interval '1 day';
  return true;
end $$;

create function public.set_tracker(p_req uuid, p_tracker text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.exchanges set tracker_id = p_tracker where request_id = p_req and tracker_id is null
$$;

-- Called by the tracking webhook when the carrier reports a delivery.
create function public.mark_delivered(p_tracker text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.exchanges;
begin
  update public.exchanges set status = 'delivered', delivered_at = now()
   where tracker_id = p_tracker and status = 'shipped'
   returning * into x;
  if x.id is null then return false; end if;
  perform public._log(x.request_id, 'Delivered, according to ' || x.carrier || ' tracking.');
  perform public._notify(x.recipient_id, public._title((select isbn from public.copies where id = x.copy_id)) || ' was delivered',
    'Check it against the listing. It confirms automatically in 2 days.', jsonb_build_object('request', x.request_id));
  return true;
end $$;

-- Runs every hour: expiries, reminders, missed ship windows, lost packages, auto-confirms.
create function public.worm_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n_expired int := 0; n_reminded int := 0; n_missed int := 0; n_lost int := 0; n_confirmed int := 0;
  t text;
begin
  for r in select id, sender_id, recipient_id, isbn from public.requests
           where status = 'pending' and created_at <= now() - interval '48 hours' for update skip locked loop
    if public._close_request(r.id, 'expired', 'Expired: not accepted within 48 hours.') then
      n_expired := n_expired + 1;
      perform public._notify(r.recipient_id, 'Request expired', public._name(r.sender_id) || ' didn''t respond about ' || public._title(r.isbn) || '. Your credit is back.', jsonb_build_object('request', r.id));
      perform public._notify(r.sender_id, 'Request expired', 'You didn''t respond to ' || public._name(r.recipient_id) || ' about ' || public._title(r.isbn) || '.', jsonb_build_object('request', r.id));
    end if;
  end loop;

  for r in select x.*, c.isbn from public.exchanges x join public.copies c on c.id = x.copy_id
           where x.status = 'accepted' and x.reminded_at is null and x.ship_by - now() <= interval '24 hours' and x.ship_by > now()
           for update of x skip locked loop
    update public.exchanges set reminded_at = now() where id = r.id;
    perform public._notify(r.sender_id, '24 hours left to ship', 'Add tracking for ' || public._title(r.isbn) || ' by ' || to_char(r.ship_by, 'Dy, Mon FMDD') || '.', jsonb_build_object('request', r.request_id));
    n_reminded := n_reminded + 1;
  end loop;

  for r in select x.*, c.isbn from public.exchanges x join public.copies c on c.id = x.copy_id
           where x.status = 'accepted' and x.ship_by <= now() for update of x skip locked loop
    if public._cancel_exchange(r.id, 'Cancelled: no tracking within 3 days.',
         public._name(r.sender_id) || ' didn''t ship within 3 days. The recipient''s credit was returned and nothing was charged.') then
      n_missed := n_missed + 1;
      perform public._strike(r.sender_id, r.request_id, 'Missed ship window');
      perform public._close_listing(r.copy_id, 'Declined: the owner missed a ship window.');
      perform public._notify(r.recipient_id, 'Exchange cancelled', public._name(r.sender_id) || ' didn''t ship ' || public._title(r.isbn) || ' in time. Your credit is back in your wallet.', jsonb_build_object('request', r.request_id));
      perform public._notify(r.sender_id, 'Exchange cancelled', 'You didn''t ship ' || public._title(r.isbn) || ' within 3 days, so your account got a strike. 3 strikes in 6 months pauses requests.', jsonb_build_object('request', r.request_id));
    end if;
  end loop;

  for r in select x.*, c.isbn from public.exchanges x join public.copies c on c.id = x.copy_id
           where x.status = 'shipped' and x.shipped_at <= now() - interval '10 days' for update of x skip locked loop
    t := 'Tracking hasn''t shown a delivery in 10 days, so this exchange is marked lost.';
    if public._cancel_exchange(r.id, 'Cancelled: lost in the mail.', t) then
      n_lost := n_lost + 1;
      update public.listings set closed_at = now() where copy_id = r.copy_id and closed_at is null;
      update public.copies set removed_at = now() where id = r.copy_id;
      perform public._notify(r.recipient_id, public._title(r.isbn) || ' looks lost', t || ' Your credit is back.', jsonb_build_object('request', r.request_id));
      perform public._notify(r.sender_id, public._title(r.isbn) || ' looks lost', t || ' No credit was earned. If you bought insurance, file a claim with the carrier.', jsonb_build_object('request', r.request_id));
    end if;
  end loop;

  for r in select id from public.exchanges
           where status = 'delivered' and delivered_at <= now() - interval '2 days' for update skip locked loop
    if public._complete(r.id, 'Confirmed automatically 2 days after delivery.') then
      n_confirmed := n_confirmed + 1;
    end if;
  end loop;

  return jsonb_build_object('expired', n_expired, 'reminded', n_reminded, 'missed', n_missed, 'lost', n_lost, 'confirmed', n_confirmed);
end $$;

-- ============================================================================
-- Permissions: closed by default, opened one function at a time.
-- ============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant execute on function
  public.get_state(),
  public.handle_available(text),
  public.save_profile(text, text, text, text, text[], text),
  public.save_address(text, text, text, text, text, text),
  public.toggle_wish(text),
  public.add_copy(text, text, text),
  public.update_copy(uuid, text, text, text[]),
  public.set_available(uuid, boolean),
  public.remove_copy(uuid),
  public.request_book(uuid),
  public.withdraw_request(uuid),
  public.decline_request(uuid),
  public.accept_request(uuid),
  public.ship_exchange(uuid, text, text),
  public.confirm_received(uuid),
  public.report_problem(uuid, text),
  public.rate_exchange(uuid, int),
  public.mark_read(bigint[]),
  public.delete_account(),
  public.resolve_dispute(uuid, boolean, text),
  public.app_config()
to authenticated;

grant execute on function
  public.app_config(),
  public.get_book(text),
  public.upsert_book(text, text, text, int, text, text, text),
  public.stripe_customer_for(uuid),
  public.set_stripe_customer(uuid, text),
  public.credit_topup(uuid, int, text, text, text),
  public.record_refund(text, int),
  public.set_tracker(uuid, text),
  public.rate_limit(uuid, text),
  public.mark_delivered(text),
  public.worm_tick(),
  public.resolve_dispute(uuid, boolean, text)
to service_role;
