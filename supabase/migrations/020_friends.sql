-- ─────────────────────────────────────────────────────────────────────────────
-- Friends — send/accept requests, then compare progress (words tracked,
-- current HSK, streak) with people who've accepted. One table doubles as
-- both the request and the friendship: 'accepted' rows *are* the friendship,
-- so there's no separate friends table to keep in sync with it.
-- ─────────────────────────────────────────────────────────────────────────────

create type friend_request_status as enum ('pending', 'accepted', 'declined');

create table if not exists friend_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        friend_request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friend_requests_no_self check (requester_id <> addressee_id)
);

-- At most one *pending* request between any two users regardless of
-- direction — normalizing the pair keeps A→B and B→A from coexisting.
-- Declined/accepted rows are exempt so a new request can follow a decline,
-- and re-friending after an unfriend (row deleted) is just a fresh insert.
create unique index if not exists friend_requests_pending_pair_idx
  on friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where status = 'pending';

create index if not exists friend_requests_requester_idx on friend_requests(requester_id);
create index if not exists friend_requests_addressee_idx on friend_requests(addressee_id);

alter table friend_requests enable row level security;

create policy "friend_requests_select_own" on friend_requests
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friend_requests_insert_own" on friend_requests
  for insert with check (auth.uid() = requester_id);

-- Only the addressee can resolve a still-pending request (accept/decline).
create policy "friend_requests_update_addressee" on friend_requests
  for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id);

-- Either side can remove the row outright: requester cancels a pending
-- request, either party unfriends an accepted one.
create policy "friend_requests_delete_own" on friend_requests
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ─── Email lookup ───────────────────────────────────────────────────────────
-- Regular clients can't query auth.users at all — this is the one narrow
-- window into it: given an exact email, return just enough to send a
-- request. Same inherent "does this email have an account" signal any
-- add-by-email feature exposes; nothing else about the account leaks.
create function find_user_by_email(p_email text)
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer
set search_path = public
as $$
  select
    u.id,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email) as display_name,
    u.raw_user_meta_data->>'avatar_url' as avatar_url
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

revoke all on function find_user_by_email(text) from public;
grant execute on function find_user_by_email(text) to authenticated;

-- ─── Friends + requests listing ─────────────────────────────────────────────
-- All three read auth.users for display name/avatar, which the calling
-- client can't do directly — security definer, but every row returned is
-- one auth.uid() is already a party to (no p_user_id trusted from the
-- caller), same pattern as 019's get_due_words fix.

create function get_friends()
returns table (
  friend_id     uuid,
  request_id    uuid,
  display_name  text,
  avatar_url    text,
  since         timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select
    case when fr.requester_id = auth.uid() then fr.addressee_id else fr.requester_id end as friend_id,
    fr.id as request_id,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email) as display_name,
    u.raw_user_meta_data->>'avatar_url' as avatar_url,
    fr.responded_at as since
  from friend_requests fr
  join auth.users u
    on u.id = case when fr.requester_id = auth.uid() then fr.addressee_id else fr.requester_id end
  where fr.status = 'accepted'
    and (fr.requester_id = auth.uid() or fr.addressee_id = auth.uid())
  order by fr.responded_at desc nulls last;
$$;

revoke all on function get_friends() from public;
grant execute on function get_friends() to authenticated;

create function get_incoming_friend_requests()
returns table (
  request_id    uuid,
  user_id       uuid,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select fr.id, fr.requester_id,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email),
    u.raw_user_meta_data->>'avatar_url',
    fr.created_at
  from friend_requests fr
  join auth.users u on u.id = fr.requester_id
  where fr.addressee_id = auth.uid() and fr.status = 'pending'
  order by fr.created_at desc;
$$;

revoke all on function get_incoming_friend_requests() from public;
grant execute on function get_incoming_friend_requests() to authenticated;

create function get_outgoing_friend_requests()
returns table (
  request_id    uuid,
  user_id       uuid,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select fr.id, fr.addressee_id,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email),
    u.raw_user_meta_data->>'avatar_url',
    fr.created_at
  from friend_requests fr
  join auth.users u on u.id = fr.addressee_id
  where fr.requester_id = auth.uid() and fr.status = 'pending'
  order by fr.created_at desc;
$$;

revoke all on function get_outgoing_friend_requests() from public;
grant execute on function get_outgoing_friend_requests() to authenticated;

-- ─── Friend progress ─────────────────────────────────────────────────────────
-- Mirrors get_hsk_level_stats() but for a friend's rows, gated by an
-- explicit accepted-friendship check instead of RLS (security definer
-- bypasses RLS on vocabulary_mastery/daily_learning_batches entirely, so the
-- check has to happen in here). Raises rather than silently returning
-- nothing so a client that got the friend_id wrong sees an error, not blank
-- stats that look like "no data yet".
create function get_friend_stats(p_friend_id uuid)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  is_friend boolean;
  result json;
begin
  select exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = p_friend_id)
        or (addressee_id = auth.uid() and requester_id = p_friend_id))
  ) into is_friend;

  if not is_friend then
    raise exception 'Not friends with this user';
  end if;

  select json_build_object(
    'words_tracked', (select count(*) from vocabulary_mastery where user_id = p_friend_id),
    'assessment_hsk_level', (select assessment_hsk_level from user_settings where user_id = p_friend_id),
    'hsk_stats', (
      select coalesce(json_agg(json_build_object(
        'level', level, 'total', total,
        'high_stability_count', high_stability_count, 'mastery_ratio', mastery_ratio
      )), '[]'::json)
      from (
        select
          floor(hsk_level)::int as level,
          count(*) as total,
          count(*) filter (where stability >= 21) as high_stability_count,
          round(count(*) filter (where stability >= 21)::numeric / nullif(count(*), 0), 4) as mastery_ratio
        from vocabulary_mastery
        where user_id = p_friend_id
        group by floor(hsk_level)
      ) s
    ),
    'batch_dates', (
      select coalesce(json_agg(distinct batch_date order by batch_date), '[]'::json)
      from daily_learning_batches
      where user_id = p_friend_id
    )
  ) into result;

  return result;
end;
$$;

revoke all on function get_friend_stats(uuid) from public;
grant execute on function get_friend_stats(uuid) to authenticated;
