-- CheckMate v2: chat archive + voice/media RLS hardening
-- Safe to run after the existing CheckMate SQL files.

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
on public.conversation_settings for all to authenticated
using (user_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "authenticated users can upload chat media" on storage.objects;
drop policy if exists "authenticated users can read chat media" on storage.objects;
create policy "chat users upload only to own media folder"
on storage.objects for insert to authenticated
with check (bucket_id='chat-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "authenticated users can read chat media"
on storage.objects for select to authenticated
using (bucket_id='chat-media');

drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
on public.messages for insert to authenticated
with check (sender_id=auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "senders update own messages" on public.messages;
create policy "senders update own messages"
on public.messages for update to authenticated
using (sender_id=auth.uid() and public.is_conversation_member(conversation_id))
with check (sender_id=auth.uid() and public.is_conversation_member(conversation_id));
