-- CheckMate: typing/last seen + reactions + replies + message deletion
-- Run AFTER supabase.sql + username_migration.sql + offline_archive_seen_migration.sql.

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Let signed-in users update only their own profile metadata (used for last seen).
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;
alter table public.messages add column if not exists deleted_at timestamptz;

-- Existing members can update/delete only their own messages.
drop policy if exists "senders update own messages" on public.messages;
create policy "senders update own messages"
on public.messages
for update to authenticated
using (sender_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('❤️','😂','👍')),
  created_at timestamptz not null default now(),
  primary key (message_id,user_id,reaction)
);

alter table public.message_reactions enable row level security;

drop policy if exists "members read message reactions" on public.message_reactions;
create policy "members read message reactions"
on public.message_reactions
for select to authenticated
using (exists (select 1 from public.messages m where m.id=message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "users add own message reactions" on public.message_reactions;
create policy "users add own message reactions"
on public.message_reactions
for insert to authenticated
with check (user_id=auth.uid() and exists (select 1 from public.messages m where m.id=message_id and public.is_conversation_member(m.conversation_id)));

drop policy if exists "users remove own message reactions" on public.message_reactions;
create policy "users remove own message reactions"
on public.message_reactions
for delete to authenticated
using (user_id=auth.uid());

create index if not exists message_reactions_message_idx on public.message_reactions(message_id);
create index if not exists messages_reply_idx on public.messages(reply_to);

DO $$
BEGIN
  BEGIN alter publication supabase_realtime add table public.message_reactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
