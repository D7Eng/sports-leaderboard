-- Sports Leaderboard database schema for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.
--
-- Roles:
--   student      default for everyone who signs up; can view standings
--   coordinator  can enter, edit and remove scores and placings
--   admin        full access: competitions, teams, sports, scores and people's roles

create extension if not exists pgcrypto;

-- ---------- people ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  college text not null default '' check (char_length(college) <= 80),
  email text not null default '',
  role text not null default 'student' check (role in ('student', 'coordinator', 'admin')),
  created_at timestamptz not null default now()
);

-- Every new sign-up gets a profile with the student role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, college)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    left(coalesce(new.raw_user_meta_data ->> 'college', ''), 80)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The signed-in person's role. security definer so policies can call it
-- without recursing through the profiles policies.
create or replace function public.my_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none');
$$;

-- People can change their own name and college, never their own role.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- auth.uid() is null only for the dashboard's SQL editor, which is how the first admin is set.
  if new.role is distinct from old.role and auth.uid() is not null and public.my_role() <> 'admin' then
    raise exception 'Only an admin can change roles';
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'Email is managed by sign-in';
  end if;
  if new.id = auth.uid() and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You are the only admin. Make someone else an admin first.';
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- competitions ----------

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'Intramurals',
  medal_points numeric[] not null default '{5,3,1}',
  logo_url text,
  background_url text,
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#1d6a43' check (color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text,
  created_at timestamptz not null default now(),
  unique (competition_id, name)
);

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  format text not null check (format in ('match', 'placing')),
  draws boolean not null default true,
  win_points numeric not null default 3,
  draw_points numeric not null default 1,
  loss_points numeric not null default 0,
  unit text not null default 'Points',
  place_points numeric[] not null default '{10,8,6,5,4,3}',
  created_at timestamptz not null default now(),
  unique (competition_id, name)
);

-- One row per match (kind = 'match') or per ranked event (kind = 'event').
create table public.results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  sport_id uuid not null references public.sports (id) on delete cascade,
  kind text not null check (kind in ('match', 'event')),
  home_team uuid references public.teams (id) on delete cascade,
  away_team uuid references public.teams (id) on delete cascade,
  home_score numeric check (home_score >= 0),
  away_score numeric check (away_score >= 0),
  event_name text check (char_length(event_name) <= 60),
  placings uuid[],                       -- team ids, 1st place first
  entered_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (kind = 'match' and home_team is not null and away_team is not null and home_team <> away_team
      and home_score is not null and away_score is not null)
    or
    (kind = 'event' and event_name is not null and cardinality(placings) >= 1)
  )
);

create index results_competition_idx on public.results (competition_id);
create index teams_competition_idx on public.teams (competition_id);
create index sports_competition_idx on public.sports (competition_id);

-- Removing a team also removes it from event placings.
create or replace function public.remove_team_from_placings()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.results set placings = array_remove(placings, old.id)
    where kind = 'event' and old.id = any (placings);
  delete from public.results where kind = 'event' and cardinality(placings) = 0;
  return old;
end;
$$;

create trigger remove_team_from_placings
  after delete on public.teams
  for each row execute function public.remove_team_from_placings();

-- ---------- row level security ----------

alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.teams enable row level security;
alter table public.sports enable row level security;
alter table public.results enable row level security;

-- Profiles: you see your own; coordinators and admins see everyone's (to show who entered a score).
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() in ('coordinator', 'admin'));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "admin edits profiles" on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Standings: every signed-in person can read.
create policy "signed in read" on public.competitions for select to authenticated using (true);
create policy "signed in read" on public.teams for select to authenticated using (true);
create policy "signed in read" on public.sports for select to authenticated using (true);
create policy "signed in read" on public.results for select to authenticated using (true);

-- Setup: admins only.
create policy "admin writes" on public.competitions for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "admin writes" on public.teams for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "admin writes" on public.sports for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Scores: coordinators and admins.
create policy "staff write scores" on public.results for all to authenticated
  using (public.my_role() in ('coordinator', 'admin'))
  with check (public.my_role() in ('coordinator', 'admin'));

-- ---------- live updates ----------

alter publication supabase_realtime add table public.competitions, public.teams, public.sports, public.results;

-- ---------- images (logos, backgrounds) ----------
-- Public image storage for logos and backgrounds. Anyone can view the images;
-- only admins can upload, replace or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins upload branding" on storage.objects;
drop policy if exists "admins update branding" on storage.objects;
drop policy if exists "admins delete branding" on storage.objects;

create policy "admins upload branding" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.my_role() = 'admin');
create policy "admins update branding" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.my_role() = 'admin')
  with check (bucket_id = 'branding' and public.my_role() = 'admin');
create policy "admins delete branding" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.my_role() = 'admin');
