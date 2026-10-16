-- Sports Leaderboard update: member profiles.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
--
-- Adds "I am a" (student, athlete, faculty or guest) and a profile photo to every
-- account, and a photo storage area where each person can only change their own photo.
-- This is separate from access roles: admins still decide who is a coordinator or admin.

alter table public.profiles
  add column if not exists member_type text not null default 'student',
  add column if not exists avatar_url text;

alter table public.profiles drop constraint if exists profiles_member_type_check;
alter table public.profiles add constraint profiles_member_type_check
  check (member_type in ('student', 'athlete', 'faculty', 'guest'));

-- New sign-ups keep the "I am a" they picked on the sign-up form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  kind text := coalesce(new.raw_user_meta_data ->> 'member_type', 'student');
begin
  insert into public.profiles (id, email, full_name, college, member_type)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    left(coalesce(new.raw_user_meta_data ->> 'college', ''), 80),
    case when kind in ('student', 'athlete', 'faculty', 'guest') then kind else 'student' end
  );
  return new;
end;
$$;

-- Profile photos: anyone can view them; each person can only upload to their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own avatar upload" on storage.objects;
drop policy if exists "own avatar update" on storage.objects;
drop policy if exists "own avatar delete" on storage.objects;

create policy "own avatar upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
