-- Sports Leaderboard update: login links per competition, and every live competition on the login screen.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
--
-- Adds a "show on the login screen" switch to each competition, and replaces the
-- public ranking function so it can return every live competition, or just the one
-- named in a competition's login link. Visitors still see only the overall ranking.

alter table public.competitions add column if not exists is_live boolean not null default true;

-- Overall ranking of one competition (top 10). Called only by public_standings.
create or replace function public.competition_standings(cid uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with comp as (
    select * from competitions where id = cid
  ),
  -- head-to-head: one row per team per match
  m as (
    select r.sport_id, x.team, x.f, x.a, s.win_points, s.draw_points, s.loss_points
    from results r
    join sports s on s.id = r.sport_id and s.format = 'match'
    cross join lateral (values (r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)) as x(team, f, a)
    where r.competition_id = cid and r.kind = 'match'
  ),
  ms as (
    select sport_id, team,
      sum(case when f > a then win_points when f < a then loss_points else draw_points end) as pts,
      sum(f - a) as diff, sum(f) as gf, 0::bigint as g, 0::bigint as sv, 0::bigint as b
    from m group by sport_id, team
  ),
  -- placings: one row per team per event
  e as (
    select r.sport_id, p.team, p.ord, s.place_points
    from results r
    join sports s on s.id = r.sport_id and s.format = 'placing'
    cross join lateral unnest(r.placings) with ordinality as p(team, ord)
    where r.competition_id = cid and r.kind = 'event'
  ),
  es as (
    select sport_id, team,
      sum(coalesce(place_points[ord], 0)) as pts, 0::numeric as diff, 0::numeric as gf,
      count(*) filter (where ord = 1) as g, count(*) filter (where ord = 2) as sv, count(*) filter (where ord = 3) as b
    from e group by sport_id, team
  ),
  -- rank inside each sport (same tie-breaks as the site)
  sr as (
    select u.sport_id, u.team,
      row_number() over (partition by u.sport_id order by u.pts desc, u.diff desc, u.gf desc, u.g desc, u.sv desc, u.b desc, t.name) as rk
    from (select * from ms union all select * from es) u
    join teams t on t.id = u.team
  ),
  ov as (
    select t.id, t.name, t.logo_url, t.color,
      count(sr.rk) filter (where sr.rk = 1) as gold,
      count(sr.rk) filter (where sr.rk = 2) as silver,
      count(sr.rk) filter (where sr.rk = 3) as bronze,
      coalesce(sum(comp.medal_points[sr.rk]), 0) as points
    from teams t
    join comp on comp.id = t.competition_id
    left join sr on sr.team = t.id
    group by t.id, t.name, t.logo_url, t.color
  ),
  ranked as (
    select ov.*, row_number() over (order by points desc, gold desc, silver desc, bronze desc, name) as rank from ov
  )
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'kind', c.kind, 'logo', c.logo_url, 'accent', c.accent_color, 'background', c.background_url,
    'updated_at', (select max(r.created_at) from results r where r.competition_id = cid),
    'results', (select count(*) from results r where r.competition_id = cid),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', rank, 'name', name, 'logo', logo_url, 'color', color,
        'gold', gold, 'silver', silver, 'bronze', bronze, 'points', points) order by rank)
      from ranked where rank <= 10), '[]'::jsonb)
  )
  from comp c;
$$;

revoke all on function public.competition_standings(uuid) from public, anon, authenticated;

-- What visitors see before logging in: every live competition, most recently active first,
-- or only the competition in a login link (comp_id).
drop function if exists public.public_standings();
create or replace function public.public_standings(comp_id uuid default null)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object('competitions', coalesce(jsonb_agg(public.competition_standings(c.id)
      order by coalesce((select max(r.created_at) from results r where r.competition_id = c.id), c.created_at) desc), '[]'::jsonb))
  from competitions c
  where case when comp_id is null then c.is_live else c.id = comp_id end;
$$;

revoke all on function public.public_standings(uuid) from public;
grant execute on function public.public_standings(uuid) to anon, authenticated;
