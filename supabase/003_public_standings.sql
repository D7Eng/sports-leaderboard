-- Sports Leaderboard update: public overall ranking for the login screen.
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
--
-- Visitors who are not logged in can call this one function. It returns only the
-- overall ranking (team names, logos, medal counts, points) of the most active
-- competition. Sport tables, scores and people stay private to signed-in users.

create or replace function public.public_standings()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with comp as (
    select c.*
    from competitions c
    order by coalesce((select max(r.created_at) from results r where r.competition_id = c.id), c.created_at) desc
    limit 1
  ),
  -- head-to-head: one row per team per match
  m as (
    select r.sport_id, x.team, x.f, x.a, s.win_points, s.draw_points, s.loss_points
    from results r
    join comp on comp.id = r.competition_id
    join sports s on s.id = r.sport_id and s.format = 'match'
    cross join lateral (values (r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)) as x(team, f, a)
    where r.kind = 'match'
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
    join comp on comp.id = r.competition_id
    join sports s on s.id = r.sport_id and s.format = 'placing'
    cross join lateral unnest(r.placings) with ordinality as p(team, ord)
    where r.kind = 'event'
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
  select case when not exists (select 1 from comp) then null else jsonb_build_object(
    'competition', (select jsonb_build_object('name', name, 'kind', kind, 'logo', logo_url, 'accent', accent_color, 'background', background_url) from comp),
    'updated_at', (select max(r.created_at) from results r join comp on comp.id = r.competition_id),
    'results', (select count(*) from results r join comp on comp.id = r.competition_id),
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', rank, 'name', name, 'logo', logo_url, 'color', color,
        'gold', gold, 'silver', silver, 'bronze', bronze, 'points', points) order by rank)
      from ranked where rank <= 10), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.public_standings() from public;
grant execute on function public.public_standings() to anon, authenticated;
