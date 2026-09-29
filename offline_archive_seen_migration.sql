-- CheckMate: offline sync + chat archive + seen status
-- Run AFTER supabase.sql + username_migration.sql.
-- This is a migration only; it does not delete existing messages.

alter table public.messages
  add column if not exists seen_at timestamptz;

create table if not exists public.conversation_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  archived boolean not null default false,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.conversation_settings enable row level security;

drop policy if exists "users manage their conversation settings" on public.conversation_settings;
create policy "users manage their conversation settings"
on public.conversation_settings
for all to authenticated
using (user_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

create index if not exists messages_conversation_created_idx
on public.messages(conversation_id, created_at);

create index if not exists messages_unseen_idx
on public.messages(conversation_id, sender_id, seen_at)
where seen_at is null;

create or replace function public.mark_conversation_seen(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(cid) then
    raise exception 'Not a conversation member';
  end if;

  update public.messages
  set seen_at = now()
  where conversation_id = cid
    and sender_id <> auth.uid()
    and seen_at is null;

  insert into public.conversation_settings(user_id, conversation_id, last_read_at, updated_at)
  values(auth.uid(), cid, now(), now())
  on conflict(user_id, conversation_id) do update
    set last_read_at = excluded.last_read_at,
        updated_at = now();
end;
$$;

grant execute on function public.mark_conversation_seen(uuid) to authenticated;

-- Allow a sender to see the read timestamp on their own messages.
-- The existing message SELECT policy already permits conversation members to read messages.

-- Optional realtime support for seen updates.
-- Safe if messages is already in supabase_realtime.
DO $$
BEGIN
  BEGIN
    alter publication supabase_realtime add table public.conversation_settings;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
