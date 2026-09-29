-- CheckMate username migration
-- Run this AFTER the original database setup.
-- It adds a public username field while Supabase Auth keeps an internal
-- synthetic email address behind the scenes.

alter table public.profiles add column if not exists username text;

create unique index if not exists profiles_username_unique
on public.profiles (lower(username))
where username is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text := lower(new.raw_user_meta_data->>'username');
begin
  insert into public.profiles(id, email, username)
  values(new.id, new.email, uname)
  on conflict(id) do update
    set email = excluded.email,
        username = coalesce(excluded.username, public.profiles.username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.find_user_by_username(target_username text)
returns table(id uuid, username text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username
  from public.profiles p
  where lower(p.username) = lower(target_username)
  limit 1;
$$;

grant execute on function public.find_user_by_username(text) to authenticated;
