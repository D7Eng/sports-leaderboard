import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/* ---------- constants ---------- */
const PALETTE = ["#1d6a43", "#c27a14", "#2f5fa8", "#a23b72", "#6b4fa8", "#c0463d", "#1f8a8a", "#7a7a24", "#4d6b8a", "#8a4b2a", "#3c8c3c", "#9b5fc0"];
const PRESETS = {
  Basketball:    { format: "match", draws: false, win: 2, draw: 0, loss: 1, unit: "Points" },
  Volleyball:    { format: "match", draws: false, win: 3, draw: 0, loss: 0, unit: "Sets" },
  Football:      { format: "match", draws: true,  win: 3, draw: 1, loss: 0, unit: "Goals" },
  Futsal:        { format: "match", draws: true,  win: 3, draw: 1, loss: 0, unit: "Goals" },
  Badminton:     { format: "match", draws: false, win: 1, draw: 0, loss: 0, unit: "Games" },
  "Table Tennis":{ format: "match", draws: false, win: 1, draw: 0, loss: 0, unit: "Games" },
  Chess:         { format: "match", draws: true,  win: 1, draw: 0.5, loss: 0, unit: "Points" },
  Esports:       { format: "match", draws: false, win: 3, draw: 0, loss: 0, unit: "Maps" },
  Athletics:     { format: "placing", places: [10, 8, 6, 5, 4, 3] },
  Swimming:      { format: "placing", places: [10, 8, 6, 5, 4, 3] },
  "Dance Sport": { format: "placing", places: [10, 8, 6, 5, 4, 3] },
};
const ROLE_LABEL = { admin: "Admin", coordinator: "Coordinator", student: "Viewer" };

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const dot = t => t.logo ? `<img class="tlogo" src="${esc(t.logo)}" alt="" loading="lazy">` : `<span class="swatch" style="background:${esc(t.color || "#888")}"></span>`;
const teamOf = (c, id) => c.teams.find(t => t.id === id);
const parseList = str => { const a = str.split(/[,\s]+/).filter(Boolean).map(Number); return a.length && a.every(n => Number.isFinite(n) && n >= 0) ? a : null; };
const errText = e => !e ? "Something went wrong. Try again."
  : e.code === "42501" ? "You don't have permission to do that."
  : e.code === "23505" ? "That name is already used here."
  : e.message || "Couldn't save. Check your connection and try again.";

/* ---------- state ---------- */
const configured = !SUPABASE_ANON_KEY.includes("YOUR-ANON-KEY");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let session = null, me = null, role = "student";
let comps = [], teams = [], sports = [], results = [], people = [];
let currentId = null, view = "overall", authMode = "login", recovering = false;
let flashIds = [], lastRenderedView = null, shellReady = false;
const sorts = {}, msgs = {};
try { const s = JSON.parse(localStorage.getItem("sl-ui") || "{}"); currentId = s.c || null; view = s.v || "overall"; } catch (e) {}
const rememberUi = () => { try { localStorage.setItem("sl-ui", JSON.stringify({ c: currentId, v: view })); } catch (e) {} };

// A competition's login link is ?c=<id>. Students and coordinators who arrive through one
// only see that competition; the link is remembered on this device.
const isId = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || "");
let linkComp = new URLSearchParams(location.search).get("c");
try { if (!isId(linkComp)) linkComp = localStorage.getItem("sl-link"); } catch (e) {}
if (!isId(linkComp)) linkComp = null;
const compLink = id => `${location.origin}${location.pathname}?c=${id}`;
function setLink(id) {
  linkComp = id || null;
  try { linkComp ? localStorage.setItem("sl-link", linkComp) : localStorage.removeItem("sl-link"); } catch (e) {}
  const url = new URL(location.href);
  if (linkComp) url.searchParams.set("c", linkComp); else url.searchParams.delete("c");
  history.replaceState(null, "", url);
}
if (linkComp) { setLink(linkComp); currentId = linkComp; }
const canSetup = () => role === "admin";
const canScore = () => role === "admin" || role === "coordinator";

function setMsg(id, text, ok) { msgs[id] = { text, ok }; const m = $(id); if (m) { m.textContent = text; m.className = "msg " + (ok ? "ok" : "err"); } }
const msgHTML = id => `<p class="msg ${msgs[id] ? (msgs[id].ok ? "ok" : "err") : ""}" id="${id}" role="status">${msgs[id] ? esc(msgs[id].text) : ""}</p>`;

/* ---------- data ---------- */
async function loadProfile() {
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  me = data; role = data?.role || "student";
}
async function loadAll() {
  const { data: cs, error } = await sb.from("competitions").select("*").order("created_at");
  if (error) return showBanner(errText(error));
  comps = cs || [];
  if (linkComp && !comps.some(c => c.id === linkComp)) setLink(null);
  if (linkComp && !canSetup()) comps = comps.filter(c => c.id === linkComp);
  if (!comps.some(c => c.id === currentId)) currentId = comps[0]?.id || null;
  if (currentId) {
    const [t, s, r] = await Promise.all([
      sb.from("teams").select("*").eq("competition_id", currentId).order("created_at"),
      sb.from("sports").select("*").eq("competition_id", currentId).order("created_at"),
      sb.from("results").select("*").eq("competition_id", currentId).order("created_at"),
    ]);
    teams = t.data || []; sports = s.data || []; results = r.data || [];
  } else { teams = []; sports = []; results = []; }
  if (canScore()) {
    const { data } = await sb.from("profiles").select("*").order("created_at");
    people = data || [];
  }
}
let reloadTimer = null, pendingToasts = [], liveOn = false;
function scheduleReload(payload) {
  if (payload?.table === "results" && payload.eventType === "INSERT" && payload.new?.entered_by !== session?.user?.id) pendingToasts.push(payload.new);
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadAll(); render();
    const c = comp();
    for (const r of pendingToasts.splice(0)) {
      if (!c || r.competition_id !== c.id) continue;
      const s = c.sports.find(x => x.id === r.sport_id); if (!s) continue;
      if (r.kind === "event") { const w = teamOf(c, (r.placings || [])[0]); toast(`${s.name}: ${w ? w.name + " wins " : ""}${r.event_name}`); }
      else { const H = teamOf(c, r.home_team), A = teamOf(c, r.away_team); if (H && A) toast(`${s.name}: ${H.name} ${num(+r.home_score)}–${num(+r.away_score)} ${A.name}`); }
    }
  }, 250);
}
function toast(text) {
  let box = document.querySelector(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); document.body.append(box); }
  const el = document.createElement("div"); el.className = "toast"; el.textContent = text; box.append(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 5000);
}
async function refresh() { await loadAll(); render(); }

function comp(excludeId) {
  const raw = comps.find(c => c.id === currentId); if (!raw) return null;
  const c = {
    id: raw.id, name: raw.name, kind: raw.kind, medalPts: (raw.medal_points || [5, 3, 1]).map(Number),
    logo: raw.logo_url || "", background: raw.background_url || "", accent: raw.accent_color || "", live: raw.is_live !== false,
    teams: teams.map(t => ({ id: t.id, name: t.name, color: t.color, logo: t.logo_url || "" })),
    sports: sports.map(s => ({ id: s.id, name: s.name, format: s.format, draws: s.draws, win: +s.win_points, draw: +s.draw_points, loss: +s.loss_points, unit: s.unit, places: (s.place_points || []).map(Number), matches: [], events: [] })),
  };
  for (const r of results) {
    if (r.id === excludeId) continue;
    const s = c.sports.find(x => x.id === r.sport_id); if (!s) continue;
    if (r.kind === "event") s.events.push({ id: r.id, name: r.event_name, order: r.placings || [], by: r.entered_by, at: r.created_at });
    else s.matches.push({ id: r.id, h: r.home_team, a: r.away_team, hs: +r.home_score, as: +r.away_score, by: r.entered_by, at: r.created_at });
  }
  return c;
}

/* ---------- standings ---------- */
function matchTable(c, s) {
  const rows = new Map(c.teams.map(t => [t.id, { id: t.id, name: t.name, team: t, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, diff: 0, pts: 0, formList: [] }]));
  for (const m of s.matches) {
    const H = rows.get(m.h), A = rows.get(m.a); if (!H || !A) continue;
    H.p++; A.p++; H.f += m.hs; H.a += m.as; A.f += m.as; A.a += m.hs;
    if (m.hs > m.as) { H.w++; A.l++; H.pts += s.win; A.pts += s.loss; H.formList.push("W"); A.formList.push("L"); }
    else if (m.hs < m.as) { A.w++; H.l++; A.pts += s.win; H.pts += s.loss; H.formList.push("L"); A.formList.push("W"); }
    else { H.d++; A.d++; H.pts += s.draw; A.pts += s.draw; H.formList.push("D"); A.formList.push("D"); }
  }
  const list = [...rows.values()];
  list.forEach(r => r.diff = r.f - r.a);
  list.sort((x, y) => y.pts - x.pts || y.diff - x.diff || y.f - x.f || x.name.localeCompare(y.name));
  list.forEach((r, i) => { r.pos = i + 1; r.active = r.p > 0; });
  return list;
}
function placingTable(c, s) {
  const rows = new Map(c.teams.map(t => [t.id, { id: t.id, name: t.name, team: t, e: 0, g: 0, sv: 0, b: 0, pts: 0 }]));
  for (const ev of s.events) ev.order.forEach((tid, i) => {
    const r = rows.get(tid); if (!r) return;
    r.e++; r.pts += s.places[i] || 0;
    if (i === 0) r.g++; else if (i === 1) r.sv++; else if (i === 2) r.b++;
  });
  const list = [...rows.values()];
  list.sort((x, y) => y.pts - x.pts || y.g - x.g || y.sv - x.sv || y.b - x.b || x.name.localeCompare(y.name));
  list.forEach((r, i) => { r.pos = i + 1; r.active = r.e > 0; });
  return list;
}
const sportTable = (c, s) => s.format === "placing" ? placingTable(c, s) : matchTable(c, s);
const hasResults = s => (s.format === "placing" ? s.events : s.matches).length > 0;
function overallTable(c) {
  const rows = new Map(c.teams.map(t => [t.id, { id: t.id, name: t.name, team: t, g: 0, sv: 0, b: 0, pts: 0, sports: 0 }]));
  for (const s of c.sports) {
    if (!hasResults(s)) continue;
    sportTable(c, s).filter(r => r.active).forEach((r, i) => {
      const o = rows.get(r.id); o.sports++;
      if (i < 3) o[["g", "sv", "b"][i]]++;
      o.pts += c.medalPts[i] || 0;
    });
  }
  const list = [...rows.values()];
  list.sort((x, y) => y.pts - x.pts || y.g - x.g || y.sv - x.sv || y.b - x.b || x.name.localeCompare(y.name));
  list.forEach((r, i) => r.pos = i + 1);
  return list;
}

/* ---------- table ---------- */
function tableHTML(viewKey, cols, rows) {
  const st = sorts[viewKey] || { key: "pos", dir: "asc" };
  let out = [...rows];
  if (st.key !== "pos") {
    const m = st.dir === "asc" ? 1 : -1;
    out.sort((x, y) => { const a = x[st.key], b = y[st.key]; return (typeof a === "string" ? a.localeCompare(b) : a - b) * m || x.pos - y.pos; });
  } else if (st.dir === "desc") out.reverse();
  const head = cols.map(c => {
    const aria = st.key === c.key ? ` aria-sort="${st.dir === "asc" ? "ascending" : "descending"}"` : "";
    const inner = c.sortable === false ? c.label : `<button type="button" data-sort="${c.key}" data-view="${viewKey}" title="${esc(c.title || c.label)}">${c.label}</button>`;
    return `<th scope="col" class="${c.cls || ""}"${aria}>${inner}</th>`;
  }).join("");
  const body = out.map(r => {
    const podium = r.podiumOk && r.pos <= 3 ? ` podium p${r.pos}` : "";
    return `<tr class="${podium}${flashIds.includes(r.id) ? " flash" : ""}" style="--i:${Math.min(out.indexOf(r), 12)}">${cols.map(c => `<td class="${c.cls || ""}">${c.fmt ? c.fmt(r) : esc(num(r[c.key]))}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const teamCell = r => `<button class="team-link" type="button" data-tab="team:${r.id}">${dot(r.team)}${esc(r.name)}</button>`;
const medalCell = (v, k) => `<span class="medal ${v ? k : "zero"}">${v}</span>`;
const personName = id => { const p = people.find(x => x.id === id); return p ? (p.full_name || p.email || "a coordinator") : "a coordinator"; };

/* ---------- screens ---------- */
function setupNeededScreen() {
  $("root").innerHTML = `<div class="setup-needed"><p class="eyebrow">Sports Leaderboard</p><h1>Almost ready</h1>
    <p>This site needs its database connection. Open <code>config.js</code> and paste in your Supabase project URL and anon key, then reload.</p>
    <p class="note">The README explains each step.</p></div>`;
}

function authScreen() {
  shellReady = false;
  const signup = authMode === "signup", forgot = authMode === "forgot";
  const form = recovering ? `
      <form id="newPassForm" novalidate>
        <p class="note">Choose a new password for your account.</p>
        <label for="newPass">New password<input id="newPass" type="password" autocomplete="new-password" minlength="8"></label>
        <button class="btn" type="submit">Save new password</button>${msgHTML("authMsg")}
      </form>`
    : forgot ? `
      <form id="forgotForm" novalidate>
        <p class="note">We'll email you a link to reset your password.</p>
        <label for="fEmail">Email<input id="fEmail" type="email" autocomplete="email"></label>
        <button class="btn" type="submit">Send reset link</button>${msgHTML("authMsg")}
        <button class="linkish" type="button" data-auth="login">Back to log in</button>
      </form>`
    : `
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" data-auth="login" aria-selected="${!signup}">Log in</button>
        <button type="button" role="tab" data-auth="signup" aria-selected="${signup}">Sign up</button>
      </div>
      <form id="${signup ? "signupForm" : "loginForm"}" novalidate>
        ${signup ? `
        <label for="aName">Full name<input id="aName" type="text" autocomplete="name" maxlength="80"></label>
        <label for="aCollege">College or department<input id="aCollege" type="text" maxlength="80" placeholder="e.g. College of Engineering"></label>
        <label for="aType">I am a<select id="aType">${MEMBER_INFO.map(([k, label]) => `<option value="${k}">${label}</option>`).join("")}</select></label>` : ""}
        <label for="aEmail">Email<input id="aEmail" type="email" autocomplete="email"></label>
        <label for="aPass">Password<input id="aPass" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8"></label>
        <button class="btn" type="submit">${signup ? "Create account" : "Log in"}</button>${msgHTML("authMsg")}
        ${signup ? `<p class="note">New accounts can view every standing. An admin can make you a coordinator so you can enter scores.</p>` : `<button class="linkish" type="button" data-auth="forgot">Forgot password?</button>`}
      </form>`;
  $("root").innerHTML = `<div class="auth auth-split">
    <section class="live-card" id="liveCard">${publicPanel()}</section>
    <div class="auth-card">
      <div class="auth-brand" id="authBrand">${authBrand()}</div>
      <div class="panel">${form}</div>
    </div>
  </div>`;
  const live = $("liveCard");
  live.addEventListener("mouseenter", () => live.classList.add("paused"));
  live.addEventListener("mouseleave", () => live.classList.remove("paused"));
  live.addEventListener("focusin", () => live.classList.add("paused"));
  live.addEventListener("focusout", () => live.classList.remove("paused"));
  startPublicFeed();
}

/* ---------- public live ranking (login screen) ---------- */
// Without a link: every live competition, rotating. With a link: only that competition, in its branding.
let publicData = null, publicLoaded = false, publicTimer = null, publicIdx = 0, boardShown = null;
async function loadPublic() {
  let { data, error } = await sb.rpc("public_standings", linkComp ? { comp_id: linkComp } : {});
  if (error && linkComp) ({ data, error } = await sb.rpc("public_standings")); // database without the links update
  publicData = error ? null : data; publicLoaded = true;
}
function publicList() {
  const d = publicData; if (!d) return [];
  if (Array.isArray(d.competitions)) return d.competitions;
  return d.competition ? [{ ...d.competition, updated_at: d.updated_at, results: d.results, standings: d.standings }] : [];
}
function shownPublic() {
  const list = publicList(); if (!list.length) return null;
  if (linkComp) return list.find(x => x.id === linkComp) || (list[0].id ? null : list[0]);
  publicIdx = Math.min(publicIdx, list.length - 1);
  return list[publicIdx];
}
function startPublicFeed() {
  if (publicTimer) return paintPublic();
  let first = true; // open on the competition this device last viewed
  const tick = async () => {
    if (session && !recovering) return stopPublicFeed();
    await loadPublic();
    if (first && !linkComp) { const i = publicList().findIndex(x => x.id === currentId); if (i >= 0) publicIdx = i; }
    first = false; paintPublic();
  };
  tick(); publicTimer = setInterval(tick, 20000);
}
function stopPublicFeed() { clearInterval(publicTimer); publicTimer = null; }
function paintPublic() {
  const el = $("liveCard"); if (el) { el.innerHTML = publicPanel(); animateCounts(el.querySelector(".board.enter")); }
  const br = $("authBrand"); if (br) br.innerHTML = authBrand();
  const d = shownPublic();
  applyBranding(d && (linkComp || publicList().length === 1) ? d : null);
}
function authBrand() {
  const d = linkComp ? shownPublic() : null;
  if (!d) return `<div><p class="eyebrow">Scoreboard</p><h1>Sports Leaderboard</h1></div>`;
  return `${d.logo ? `<img class="auth-logo" src="${esc(d.logo)}" alt="${esc(d.name)} logo">` : ""}
    <div><p class="eyebrow">${esc(d.kind || "Competition")} · Official leaderboard</p><h1>${esc(d.name)}</h1></div>`;
}
const crown = `<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7z" fill="currentColor"/></svg>`;
function publicPanel() {
  if (!publicLoaded) return `<div class="live-empty"><p class="eyebrow"><span class="live-dot" aria-hidden="true"></span>Live standings</p><div class="skeleton"></div><div class="skeleton short"></div></div>`;
  const list = publicList(), d = shownPublic();
  if (!d && linkComp) return `<div class="live-empty"><p class="eyebrow">Live standings</p><h2>Competition not found</h2><p class="note">This link may be for a competition that has ended or been removed.</p><div><button class="btn ghost" type="button" data-all-comps>See all competitions</button></div></div>`;
  if (!d) return `<div class="live-empty"><p class="eyebrow">Live standings</p><h2>Coming soon</h2><p class="note">The leaderboard appears here once the event starts.</p></div>`;
  const rotating = !linkComp && list.length > 1;
  const pills = !rotating ? "" : `<div class="comp-pills" role="tablist" aria-label="Competitions">${list.map((x, i) => `<button type="button" role="tab" class="comp-pill" data-pub="${i}" aria-selected="${i === publicIdx}">${x.logo ? `<img src="${esc(x.logo)}" alt="">` : ""}<span>${esc(x.name)}</span></button>`).join("")}</div>
    <div class="rotate-bar" aria-hidden="true"><span></span></div>`;
  const enter = boardShown !== (d.id || d.name); boardShown = d.id || d.name;
  const rows = (d.standings || []).map(r => ({ ...r, points: Number(r.points) }));
  const head = `<div class="live-head">${d.logo ? `<img class="live-logo" src="${esc(d.logo)}" alt="">` : ""}
    <div><p class="eyebrow"><span class="live-dot" aria-hidden="true"></span>Live standings${rotating ? ` · ${publicIdx + 1} of ${list.length}` : ""}</p><h2>${esc(d.name)}</h2></div></div>`;
  const foot = `<div class="live-foot"><p class="note">${d.results && rows.length ? `Updated ${timeAgo(d.updated_at)} · ` : ""}Log in to see every sport and match.</p>
    ${!linkComp && d.id ? `<button class="btn ghost small" type="button" data-open-comp="${esc(d.id)}">Log in to this competition →</button>` : ""}</div>`;
  let body;
  if (!d.results || !rows.length) body = `<p class="note">No results yet. The first scores will show up here.</p>`;
  else {
    const [top, second] = rows;
    const tied = second && second.points === top.points;
    const lead = !second ? "" : tied ? "Tied for first" : `Leads by ${num(top.points - second.points)} pt${top.points - second.points === 1 ? "" : "s"}`;
    const mark = (r, big) => r.logo ? `<img class="${big ? "leader-logo" : "tlogo"}" src="${esc(r.logo)}" alt="">` : `<span class="${big ? "leader-dot" : "swatch"}" style="background:${esc(r.color || "#888")}"></span>`;
    const medals = r => `<span class="medal g" title="Gold">${r.gold}</span><span class="medal s" title="Silver">${r.silver}</span><span class="medal b" title="Bronze">${r.bronze}</span>`;
    body = `<div class="leader">
        ${mark(top, true)}
        <div class="leader-text"><span class="leader-rank">${crown}No. 1</span><b>${esc(top.name)}</b><span class="note">${lead}</span></div>
        <div class="leader-pts"><b data-count="${top.points}">${num(top.points)}</b><span>pts</span></div>
      </div>
      <ol class="mini-rank">${rows.slice(1, 5).map((r, i) => `<li style="--i:${i}"><span class="mr-pos">${r.rank}</span>${mark(r)}<span class="mr-name">${esc(r.name)}</span><span class="mr-medals">${medals(r)}</span><b class="mr-pts">${num(r.points)}</b></li>`).join("")}</ol>`;
  }
  return `${pills}<div class="board${enter ? " enter" : ""}" ${rotating ? "" : 'aria-live="polite"'}>${head}${body}</div>${foot}`;
}
function timeAgo(ts) {
  if (!ts) return "just now";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`;
}

/* ---------- motion ---------- */
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Counts numbers up from zero, for stats and points when a view opens.
function animateCounts(root) {
  if (!root || reducedMotion()) return;
  root.querySelectorAll("[data-count]").forEach(el => {
    const to = Number(el.dataset.count); if (!Number.isFinite(to) || to === 0) return;
    const t0 = performance.now(), dur = 900;
    const frame = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = num(k === 1 ? to : Number.isInteger(to) ? Math.round(to * e) : Math.round(to * e * 10) / 10);
      if (k < 1 && el.isConnected) requestAnimationFrame(frame);
    };
    el.textContent = "0"; requestAnimationFrame(frame);
  });
}
let enterTimer = null;
function animateView() {
  const v = $("view"); if (!v) return;
  v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
  animateCounts(v);
  clearTimeout(enterTimer); enterTimer = setTimeout(() => v.classList.remove("enter"), 1600);
}

// Logo intro played once after logging in, over the already-drawn homepage.
let introPending = false;
function introOverlay() {
  const el = document.createElement("div"); el.className = "intro"; el.setAttribute("aria-hidden", "true");
  document.body.append(el); return el;
}
function runIntro(el, c) {
  const name = c?.name || "Sports Leaderboard";
  const initials = name.split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "SL";
  el.innerHTML = `<div class="intro-glow"></div>
    <div class="intro-inner">
      ${c?.logo ? `<img class="intro-logo" src="${esc(c.logo)}" alt="">` : `<span class="intro-mono">${esc(initials)}</span>`}
      <p class="intro-kind">${esc(c?.kind || "Scoreboard")}</p>
      <p class="intro-name">${esc(name)}</p>
      <p class="intro-hello">Welcome${me?.full_name ? `, ${esc(me.full_name.split(" ")[0])}` : ""}</p>
    </div>`;
  const img = el.querySelector("img");
  const ready = img && !img.complete ? new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 1500); }) : Promise.resolve();
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener("keydown", close);
    el.classList.add("out"); animateView();
    setTimeout(() => el.remove(), 700);
  };
  el.addEventListener("click", close);
  document.addEventListener("keydown", close);
  ready.then(() => { requestAnimationFrame(() => el.classList.add("play")); setTimeout(close, reducedMotion() ? 900 : 2700); });
}

/* ---------- icons ---------- */
const ico = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  dash: ico('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  teams: ico('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>'),
  results: ico('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  user: ico('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  gear: ico('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  shield: ico('<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  menu: ico('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  search: ico('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  bell: ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  share: ico('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  logout: ico('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  ball: ico('<circle cx="12" cy="12" r="9"/><path d="M12 3a15 15 0 0 1 0 18M3 12h18"/>'),
  flag: ico('<path d="M5 21V4h11l-1.5 4L16 12H5"/>'),
  camera: ico('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  book: ico('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>'),
  run: ico('<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 4 1 3 4 3 1"/>'),
  grad: ico('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
  star: ico('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  medal: ico('<circle cx="12" cy="15" r="6"/><path d="M8.5 10L6 3h4l2 4 2-4h4l-2.5 7"/>'),
  close: ico('<path d="M6 6l12 12M18 6L6 18"/>'),
};

/* ---------- people ---------- */
const MEMBER = { student: "Student", athlete: "Athlete", faculty: "Faculty", guest: "Guest" };
const MEMBER_INFO = [
  ["student", "Student", "Studying here and cheering for my college", I.book],
  ["athlete", "Athlete", "Competing for a team in the games", I.run],
  ["faculty", "Faculty", "Teaching, coaching or on staff", I.grad],
  ["guest", "Guest", "Alumni, family or a visitor", I.star],
];
const initialsOf = s => String(s || "").split(/[\s@._-]+/).filter(w => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const hueOf = s => [...String(s || "x")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
function avatar(p, size = "") {
  if (p?.avatar_url) return `<img class="avatar ${size}" src="${esc(p.avatar_url)}" alt="">`;
  return `<span class="avatar ${size}" style="--h:${hueOf(p?.id || p?.email)}" aria-hidden="true">${esc(initialsOf(p?.full_name || p?.email))}</span>`;
}
const myName = () => me?.full_name || session?.user?.email || "";

/* ---------- shell: sidebar + top bar ---------- */
function buildShell() {
  $("root").innerHTML = `<div class="app">
    <aside class="sidebar" id="sidebar" aria-label="Main menu">
      <div class="side-brand"><img id="eventLogo" class="event-logo" alt="" hidden><span class="brand-mono" id="brandMono" aria-hidden="true"></span>
        <div class="side-brand-text"><p class="side-kind" id="eyebrow">Scoreboard</p><b id="title">Sports Leaderboard</b></div>
        <button class="icon-btn side-close" type="button" data-close-nav aria-label="Close menu">${I.close}</button></div>
      <div class="switcher" id="switcher" hidden><label for="compSelect">Competition</label><select id="compSelect"></select></div>
      <nav class="side-nav" id="sideNav"></nav>
      <div class="side-foot" id="sideFoot"></div>
    </aside>
    <div class="scrim" data-close-nav></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn" type="button" data-toggle-nav aria-label="Menu">${I.menu}</button>
        <div class="page-title"><p class="crumb" id="crumb"></p><h1 id="pageTitle"></h1></div>
        <div class="top-actions">
          <div class="search" id="searchBox">${I.search}<input id="globalSearch" type="search" placeholder="Search teams and sports" aria-label="Search teams and sports" autocomplete="off"><kbd>/</kbd><div class="search-results" id="searchResults" hidden></div></div>
          <button class="icon-btn only-phone" type="button" data-open-search aria-label="Search">${I.search}</button>
          <span id="livePill" class="hide-phone"></span>
          <button class="icon-btn hide-phone" type="button" data-share aria-label="Copy link to this competition" title="Copy link">${I.share}</button>
          <div class="bell-wrap"><button class="icon-btn" type="button" data-bell aria-label="Latest results" aria-expanded="false">${I.bell}<span class="bell-count" id="bellCount" hidden></span></button><div class="notif-panel" id="notifPanel" hidden></div></div>
          <button class="avatar-btn" type="button" data-tab="profile" id="avatarBtn" aria-label="My profile"></button>
        </div>
      </header>
      <div class="banner" id="banner" hidden></div>
      <main id="view"></main>
    </div>
  </div>`;
  shellReady = true; lastRenderedView = null;
}
function showBanner(text) { const b = $("banner"); if (b) { b.hidden = false; b.textContent = text; } }

function navHTML(c) {
  const active = id => view === id || (id === "teams" && view.startsWith("team:"));
  const item = (id, icon, label, extra = "") => `<button class="nav-item" type="button" data-tab="${id}"${active(id) ? ' aria-current="page"' : ""} title="${esc(label)}">${icon}<span class="nav-text">${esc(label)}</span>${extra}</button>`;
  const groups = [];
  if (c) {
    const played = c.sports.reduce((n, s) => n + s.matches.length + s.events.length, 0);
    groups.push(`<p class="nav-label">Overview</p>${item("overall", I.dash, "Dashboard")}${item("teams", I.teams, c.kind === "Intramurals" ? "Colleges" : "Teams", `<span class="nav-count">${c.teams.length}</span>`)}${item("results", I.results, "Results", `<span class="nav-count">${played}</span>`)}`);
    if (c.sports.length) groups.push(`<p class="nav-label">Sports</p>${c.sports.map(s => item(s.id, s.format === "placing" ? I.flag : I.ball, s.name)).join("")}`);
  } else groups.push(`<p class="nav-label">Overview</p>${item("overall", I.dash, "Dashboard")}`);
  groups.push(`<p class="nav-label">Account</p>${item("profile", I.user, "My profile")}${canSetup() ? (c ? item("setup", I.gear, "Setup") : "") + item("people", I.shield, "People") : ""}`);
  return groups.map(g => `<div class="nav-group">${g}</div>`).join("");
}

function pageHeading(c) {
  const kindTeams = c?.kind === "Intramurals" ? "Colleges" : "Teams";
  if (view === "profile") return ["Account", "My profile"];
  if (view === "people") return ["Admin", "People"];
  if (!c) return ["", "Dashboard"];
  if (view === "setup") return ["Admin", "Setup"];
  if (view === "teams") return [c.name, kindTeams];
  if (view === "results") return [c.name, "Results"];
  if (view.startsWith("team:")) return [kindTeams, teamOf(c, view.slice(5))?.name || ""];
  const s = c.sports.find(x => x.id === view);
  if (s) return [s.format === "placing" ? "Placings" : "Head-to-head", s.name];
  return [c.name, "Dashboard"];
}

/* ---------- notifications (results since you last looked) ---------- */
const seenKey = () => `sl-seen-${currentId}`;
function lastSeen(c) {
  let v = ""; try { v = localStorage.getItem(seenKey()) || ""; } catch (e) {}
  if (!v) { v = allResults(c)[0]?.at || new Date().toISOString(); markSeen(v); }
  return v;
}
function markSeen(at) { try { localStorage.setItem(seenKey(), at); } catch (e) {} }
function unseen(c) { const s = lastSeen(c); return allResults(c).filter(r => String(r.at) > s && r.by !== session?.user?.id); }
function paintBell(c) {
  const n = c ? unseen(c).length : 0, b = $("bellCount");
  b.hidden = !n; b.textContent = n > 9 ? "9+" : n;
}
function notifHTML(c) {
  const s = lastSeen(c), list = allResults(c).slice(0, 8);
  return `<div class="np-head"><b>Latest results</b><button class="linkish" type="button" data-tab="results">See all</button></div>
    <ul class="list feed">${list.length ? list.map(r => `<li class="${String(r.at) > s ? "is-new" : ""}">${resultLine(c, r)}<span class="feed-meta">${esc(r.sport.name)} · ${timeAgo(r.at)}</span></li>`).join("") : `<li class="empty">No results yet.</li>`}</ul>`;
}

/* ---------- search ---------- */
function searchHits(c, q) {
  q = q.trim().toLowerCase(); if (!c || !q) return [];
  const hits = [
    ...c.sports.filter(s => s.name.toLowerCase().includes(q)).map(s => ({ tab: s.id, icon: s.format === "placing" ? I.flag : I.ball, label: s.name, sub: "Sport" })),
    ...c.teams.filter(t => t.name.toLowerCase().includes(q)).map(t => ({ tab: "team:" + t.id, icon: dot(t), label: t.name, sub: c.kind === "Intramurals" ? "College" : "Team" })),
  ];
  return hits.slice(0, 8);
}
function paintSearch() {
  const box = $("searchResults"), q = $("globalSearch").value, hits = searchHits(comp(), q);
  if (!q.trim()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" class="sr-item${i === 0 ? " first" : ""}" data-tab="${h.tab}" data-search-pick>${h.icon}<span>${esc(h.label)}</span><small>${h.sub}</small></button>`).join("")
    : `<p class="empty">Nothing matches "${esc(q.trim())}".</p>`;
}
function closeSearch() { const i = $("globalSearch"); if (i) i.value = ""; const r = $("searchResults"); if (r) r.hidden = true; document.body.classList.remove("searching"); }

function render() {
  if (!session) return authScreen();
  if (!shellReady) buildShell();
  const keep = captureForm();
  const c = comp();
  applyBranding(c);

  if ((view === "setup" || view === "people") && !canSetup()) view = "overall";
  if (c) {
    if (view.startsWith("team:") && !c.teams.some(t => "team:" + t.id === view)) view = "overall";
    if (!["overall", "teams", "results", "profile", "setup", "people"].includes(view) && !view.startsWith("team:") && !c.sports.some(s => s.id === view)) view = "overall";
  } else if (!["overall", "profile", "people"].includes(view)) view = "overall";

  $("title").textContent = c ? c.name : "Sports Leaderboard";
  $("eyebrow").textContent = c ? `${c.kind || "Competition"} · ${c.sports.length} sport${c.sports.length === 1 ? "" : "s"}` : "Scoreboard";
  $("brandMono").textContent = initialsOf(c?.name || "Sports Leaderboard"); $("brandMono").hidden = !!c?.logo;
  $("switcher").hidden = !(comps.length > 1 || canSetup());
  $("compSelect").innerHTML = comps.map(x => `<option value="${x.id}"${x.id === currentId ? " selected" : ""}>${esc(x.name)}</option>`).join("") + (canSetup() ? `<option value="__new">+ New competition…</option>` : "");
  $("sideNav").innerHTML = navHTML(c);
  $("sideFoot").innerHTML = `${avatar(me)}<div class="sf-text"><b>${esc(myName())}</b><span>${MEMBER[me?.member_type] || "Member"} · ${ROLE_LABEL[role]}</span></div><button class="icon-btn" type="button" data-signout aria-label="Log out" title="Log out">${I.logout}</button>`;
  $("livePill").innerHTML = `<span class="live-pill${liveOn ? "" : " off"}" title="${liveOn ? "Scores update live" : "Reconnecting…"}"><span class="live-dot" aria-hidden="true"></span>${liveOn ? "Live" : "Offline"}</span>`;
  $("avatarBtn").innerHTML = `${avatar(me)}<span class="ab-text"><b>${esc((me?.full_name || "").split(" ")[0] || "Profile")}</b><small>${ROLE_LABEL[role]}</small></span>`;
  paintBell(c);
  const [crumb, title] = pageHeading(c);
  $("crumb").textContent = crumb; $("pageTitle").textContent = title;
  document.title = `${title}${c ? " · " + c.name : ""}`;

  const v = $("view"), entering = lastRenderedView !== view + currentId;
  if (view === "profile") v.innerHTML = profileView();
  else if (view === "people") v.innerHTML = peopleView();
  else if (!c) v.innerHTML = canSetup() ? `<div class="panel empty-hero"><h2>Start your first competition</h2><p class="note">Create an intramurals event, league or tournament. Then add colleges or teams and the sports they play.</p><button class="btn" type="button" data-new-comp>Create competition</button></div>`
    : `<div class="panel empty-hero"><h2>No competitions yet</h2><p class="note">Check back when the organizers have set one up. Meanwhile, you can fill in <button class="linkish" type="button" data-tab="profile">your profile</button>.</p></div>`;
  else if (view === "overall") v.innerHTML = overallView(c);
  else if (view === "teams") v.innerHTML = teamsView(c);
  else if (view === "results") v.innerHTML = resultsView(c);
  else if (view.startsWith("team:")) v.innerHTML = teamView(c, view.slice(5));
  else if (view === "setup") v.innerHTML = setupView(c);
  else { const s = c.sports.find(x => x.id === view); v.innerHTML = s.format === "placing" ? placingView(c, s) : matchView(c, s); }
  if (lastRenderedView === view + currentId) restoreForm(keep);
  lastRenderedView = view + currentId;
  if (entering) animateView();
  applySportFormat();
  if (flashIds.length) { flashIds = []; setTimeout(() => document.querySelectorAll("tr.flash").forEach(t => t.classList.remove("flash")), 1200); }
}

function captureForm() {
  const o = {};
  document.querySelectorAll("#view input, #view select").forEach(el => { if (el.id) o[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value; });
  return { o, focus: document.activeElement && document.activeElement.id };
}
function restoreForm(k) {
  for (const [id, val] of Object.entries(k.o)) {
    const el = $(id); if (!el || el.dataset.noRestore !== undefined) continue;
    if (el.type === "checkbox" || el.type === "radio") el.checked = val;
    else if (el.tagName === "SELECT") { if ([...el.options].some(o => o.value === val)) el.value = val; }
    else el.value = val;
  }
  if (k.focus && $(k.focus) && $(k.focus).closest("#view")) $(k.focus).focus();
}
function applySportFormat() {
  if (!$("spFormat")) return;
  const p = $("spFormat").value === "placing";
  $("matchOpts").hidden = p; $("placeOpts").hidden = !p; $("spDraw").disabled = !$("spDraws").checked;
}

function overallView(c) {
  if (!c.teams.length || !c.sports.length) return `<div class="panel empty-hero"><h2>Getting ready</h2><p class="note">${canSetup() ? `Add teams and sports in <button class="linkish" data-tab="setup" type="button">Setup</button> to start the leaderboard.` : "The organizers are still adding teams and sports."}</p></div>`;
  const rows = overallTable(c); rows.forEach(r => r.podiumOk = r.pts > 0);
  const feed = allResults(c);
  // rank movement since the most recent result
  const prev = feed.length > 1 ? new Map(overallTable(comp(feed[0].id)).map(r => [r.id, r.pos])) : null;
  rows.forEach(r => r.move = prev ? (prev.get(r.id) || r.pos) - r.pos : 0);
  const unitT = c.kind === "Intramurals" ? "College" : "Team";
  const cols = [
    { key: "pos", label: "#", cls: "pos" },
    { key: "move", label: "", sortable: false, cls: "move", fmt: r => r.move > 0 ? `<span class="up" title="Up ${r.move} since the last result">▲${r.move}</span>` : r.move < 0 ? `<span class="down" title="Down ${-r.move} since the last result">▼${-r.move}</span>` : `<span class="same" title="No change">–</span>` },
    { key: "name", label: unitT, cls: "team", fmt: teamCell },
    { key: "g", label: "Gold", fmt: r => medalCell(r.g, "g") },
    { key: "sv", label: "Silver", fmt: r => medalCell(r.sv, "s") },
    { key: "b", label: "Bronze", fmt: r => medalCell(r.b, "b") },
    { key: "sports", label: "Sports", cls: "opt", title: "Sports with at least one result" },
    { key: "pts", label: "Pts", cls: "pts", title: "Overall points" },
  ];
  const matches = c.sports.reduce((n, s) => n + s.matches.length, 0), events = c.sports.reduce((n, s) => n + s.events.length, 0);
  const done = c.sports.filter(hasResults).length;
  const medals = rows.reduce((n, r) => n + r.g + r.sv + r.b, 0);
  const top = rows.filter(r => r.pts > 0).slice(0, 3);

  // KPI cards
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d; });
  const perDay = days.map(d => feed.filter(r => { const t = new Date(r.at); return t >= d && t < new Date(d.getTime() + 864e5); }).length);
  const week = perDay.reduce((a, b) => a + b, 0);
  const kpis = `<div class="kpis">
    <div class="kpi" style="--i:0"><div class="kpi-top"><span>Results posted</span>${I.results}</div><b class="kpi-num" data-count="${feed.length}">${feed.length}</b>
      ${sparkline(perDay, days)}<p class="kpi-foot">${matches} match${matches === 1 ? "" : "es"} · ${events} event${events === 1 ? "" : "s"} · <b>${week}</b> this week</p></div>
    <div class="kpi" style="--i:1"><div class="kpi-top"><span>Sports under way</span>${I.ball}</div><b class="kpi-num"><span data-count="${done}">${done}</span><small>/${c.sports.length}</small></b>
      <div class="meter" role="img" aria-label="${done} of ${c.sports.length} sports have results"><span style="width:${c.sports.length ? Math.round(done / c.sports.length * 100) : 0}%"></span></div>
      <p class="kpi-foot">${c.sports.length - done ? `${c.sports.length - done} still to start` : "Every sport has results"}</p></div>
    <div class="kpi" style="--i:2"><div class="kpi-top"><span>Medals awarded</span>${I.medal}</div><b class="kpi-num" data-count="${medals}">${medals}</b>
      <p class="kpi-medals">${medalCell(rows.reduce((n, r) => n + r.g, 0), "g")} gold ${medalCell(rows.reduce((n, r) => n + r.sv, 0), "s")} silver ${medalCell(rows.reduce((n, r) => n + r.b, 0), "b")} bronze</p>
      <p class="kpi-foot">Top 3 of each sport</p></div>
    <div class="kpi accent" style="--i:3"><div class="kpi-top"><span>Leading ${unitT.toLowerCase()}</span>${I.star}</div>
      <b class="kpi-lead">${top[0] ? `${dot(top[0].team)}${esc(top[0].name)}` : "No results yet"}</b>
      <p class="kpi-foot">${top[0] ? `${num(top[0].pts)} pts${top[1] ? ` · ${top[0].pts === top[1].pts ? "tied" : `+${num(top[0].pts - top[1].pts)} ahead`}` : ""}` : `${c.teams.length} ${unitT.toLowerCase()}s competing`}</p></div>
  </div>`;

  // podium: 2nd, 1st, 3rd
  const lead = top.length > 1 ? top[0].pts - top[1].pts : 0;
  const step = (r, place) => !r ? `<div class="step p${place} empty"></div>` : `
    <button class="step p${place}" type="button" data-tab="team:${r.id}">
      <span class="step-mark${r.team.logo ? " has-logo" : ""}">${r.team.logo ? `<img src="${esc(r.team.logo)}" alt="">` : `<span class="step-dot" style="background:${esc(r.team.color)}"></span>`}</span>
      <span class="step-name">${esc(r.name)}</span>
      <span class="step-pts"><span data-count="${r.pts}">${num(r.pts)}</span> pts</span>
      <span class="step-block"><span>${place}</span></span>
    </button>`;
  const podium = top.length ? `<section class="podium-wrap panel">
      <div class="podium-head"><div><p class="eyebrow">Leading now</p><h2 class="leader-name">${esc(top[0].name)}</h2>
        <p class="note">${top.length < 2 ? "First on the board." : lead === 0 ? "Tied for first place." : `Ahead by ${num(lead)} pt${lead === 1 ? "" : "s"}.`} ${top[0].g} gold, ${top[0].sv} silver, ${top[0].b} bronze.</p></div>
        <p class="note">Updated ${timeAgo(feed[0]?.at)}</p></div>
      <div class="podium-stage">${step(top[1], 2)}${step(top[0], 1)}${step(top[2], 3)}</div>
    </section>` : `<section class="panel podium-wrap"><p class="eyebrow">Leading now</p><h2>No results yet</h2><p class="note">The podium fills in as soon as the first scores are in.</p></section>`;

  // points race: one bar per team, in its own color, labelled with name and points
  const maxPts = Math.max(1, ...rows.map(r => r.pts));
  const race = `<section class="panel race"><div class="sec-head"><h2>Points race</h2><span class="note">Overall points</span></div>
    <div class="race-rows">${rows.slice(0, 8).map((r, i) => `<button class="race-row" type="button" data-tab="team:${r.id}" style="--i:${i}" title="${esc(r.name)}: ${num(r.pts)} pts, ${r.g} gold, ${r.sv} silver, ${r.b} bronze">
      <span class="race-name">${dot(r.team)}${esc(r.name)}</span>
      <span class="race-track"><span class="race-bar" style="width:${Math.max(r.pts ? 2 : 0, r.pts / maxPts * 100)}%;background:${esc(r.team.color)}"></span></span>
      <b class="race-pts">${num(r.pts)}</b></button>`).join("")}</div>
    ${rows.length > 8 ? `<button class="linkish" type="button" data-tab="teams">See all ${rows.length}</button>` : ""}</section>`;

  const feedHTML = feed.length ? feed.slice(0, 7).map(r => `<li>${resultLine(c, r)}<span class="feed-meta">${esc(r.sport.name)} · ${timeAgo(r.at)}</span></li>`).join("") : `<li class="empty">Results will appear here as they come in.</li>`;
  const cards = c.sports.map(s => {
    const t = sportTable(c, s).filter(r => r.active);
    const n = s.format === "placing" ? s.events.length : s.matches.length;
    const leadT = t[0] ? `${dot(t[0].team)}${esc(t[0].name)}` : "No results yet";
    return `<button class="card" type="button" data-tab="${s.id}"><span class="card-ico">${s.format === "placing" ? I.flag : I.ball}</span><span class="k">${esc(s.name)}</span><span class="v">${leadT}</span><span class="sub">${n} ${s.format === "placing" ? (n === 1 ? "event" : "events") : (n === 1 ? "match" : "matches")} · ${s.format === "placing" ? "placings" : "head-to-head"}</span></button>`;
  }).join("");
  return `<div class="home">
    ${kpis}
    <div class="dash-row">${podium}${race}</div>
    <div class="home-grid">
      <section><div class="sec-head"><h2>Overall standings</h2><p class="note">Each sport's top 3 earn gold, silver, bronze. Points ${c.medalPts.map((p, i) => `${ordinal(i + 1)} ${num(p)}`).join(", ")}.</p></div>
        <div class="panel">${tableHTML("overall", cols, rows)}<div class="foot"><span>▲▼ shows movement since the latest result. Tap a ${unitT.toLowerCase()} for its full record.</span></div></div></section>
      <aside><div class="sec-head"><h2>Latest results</h2><button class="linkish" type="button" data-tab="results">See all</button></div><div class="panel"><ul class="list feed">${feedHTML}</ul></div></aside>
    </div>
    <section><div class="sec-head"><h2>Sports</h2><p class="note">Pick a sport to see its table${canScore() ? " and enter results" : ""}.</p></div><div class="cards">${cards}</div></section>
  </div>`;
}

// Results per day for the last 7 days, as a small area line with a dot per day.
function sparkline(values, days) {
  const w = 160, h = 40, max = Math.max(1, ...values), step = w / (values.length - 1);
  const pts = values.map((v, i) => [Math.round(i * step * 10) / 10, Math.round((h - 4 - v / max * (h - 10)) * 10) / 10]);
  const line = pts.map(p => p.join(",")).join(" ");
  const fmt = d => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `<svg class="spark" viewBox="-4 -4 ${w + 8} ${h + 8}" role="img" aria-label="Results per day, last 7 days: ${values.join(", ")}">
    <polygon points="0,${h} ${line} ${w},${h}" class="spark-area"/><polyline points="${line}" class="spark-line"/>
    ${pts.map((p, i) => `<g class="spark-pt"><circle cx="${p[0]}" cy="${p[1]}" r="9" class="spark-hit"><title>${fmt(days[i])}: ${values[i]} result${values[i] === 1 ? "" : "s"}</title></circle><circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 3.5 : 0}" class="spark-dot"/></g>`).join("")}
  </svg>`;
}

function teamsView(c) {
  const rows = overallTable(c);
  if (!rows.length) return `<div class="panel empty-hero"><h2>No ${c.kind === "Intramurals" ? "colleges" : "teams"} yet</h2>${canSetup() ? `<p class="note">Add them in <button class="linkish" data-tab="setup" type="button">Setup</button>.</p>` : ""}</div>`;
  return `<div class="team-grid">${rows.map((r, i) => `<button class="team-card" type="button" data-tab="team:${r.id}" style="--i:${Math.min(i, 12)};--tc:${esc(r.team.color)}">
      <span class="tc-rank">${r.pts ? ordinal(r.pos) : "–"}</span>
      <span class="tc-mark">${r.team.logo ? `<img src="${esc(r.team.logo)}" alt="">` : `<span class="step-dot" style="background:${esc(r.team.color)}"></span>`}</span>
      <b class="tc-name">${esc(r.name)}</b>
      <span class="tc-medals">${medalCell(r.g, "g")}${medalCell(r.sv, "s")}${medalCell(r.b, "b")}</span>
      <span class="tc-pts"><b>${num(r.pts)}</b> pts · ${r.sports} sport${r.sports === 1 ? "" : "s"}</span>
    </button>`).join("")}</div>`;
}

let resultsFilter = "all";
function resultsView(c) {
  const all = allResults(c), list = resultsFilter === "all" ? all : all.filter(r => r.sport.id === resultsFilter);
  const chips = `<div class="chips filter-chips"><button class="chip" type="button" data-rfilter="all" aria-pressed="${resultsFilter === "all"}">All sports <small>${all.length}</small></button>${c.sports.map(s => { const n = all.filter(r => r.sport.id === s.id).length; return `<button class="chip" type="button" data-rfilter="${s.id}" aria-pressed="${resultsFilter === s.id}">${esc(s.name)} <small>${n}</small></button>`; }).join("")}</div>`;
  const dayOf = r => new Date(r.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  let out = "", last = "";
  for (const r of list) {
    const d = dayOf(r);
    if (d !== last) { out += `${last ? "</ul></section>" : ""}<section class="day"><h3 class="day-head">${esc(d)}</h3><ul class="list feed panel">`; last = d; }
    out += `<li>${resultLine(c, r)}<span class="feed-meta">${esc(r.sport.name)} · ${new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${canScore() && r.by ? ` · entered by ${esc(personName(r.by))}` : ""}</span></li>`;
  }
  if (last) out += "</ul></section>";
  return `<div class="results-page">${chips}${out || `<div class="panel"><p class="empty">No results yet.</p></div>`}</div>`;
}

function profileView() {
  const p = me || {}, type = p.member_type || "student";
  const joined = p.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";
  const access = { student: "You can follow every standing and result.", coordinator: "You can enter match scores and event placings.", admin: "You can manage competitions, teams, sports and people." }[role];
  return `<div class="profile">
    <section class="panel profile-hero">
      <div class="ph-avatar">${avatar(p, "xl")}
        <label class="ph-upload upload" tabindex="0" title="Change photo" aria-label="Change photo">${I.camera}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="avatar" hidden></label></div>
      <div class="ph-text"><p class="eyebrow">${MEMBER[type]}</p><h2 class="leader-name">${esc(p.full_name || "Your name")}</h2>
        <p class="note">${esc(p.email || session.user.email)}${joined ? ` · Joined ${joined}` : ""}</p>
        <div class="ph-badges"><span class="badge ${role}">${ROLE_LABEL[role]}</span>${p.college ? `<span class="tag">${esc(p.college)}</span>` : ""}</div></div>
      ${p.avatar_url ? `<button class="btn ghost small" type="button" data-confirm data-clear-avatar>Remove photo</button>` : ""}
      ${msgHTML("avatarMsg")}
    </section>
    <div class="profile-grid">
      <form id="profileForm" class="panel" novalidate>
        <h2>Personal details</h2>
        <label for="pfName">Full name<input id="pfName" type="text" autocomplete="name" maxlength="80" value="${esc(p.full_name || "")}"></label>
        <label for="pfCollege">College or department<input id="pfCollege" type="text" maxlength="80" placeholder="e.g. College of Engineering" value="${esc(p.college || "")}"></label>
        <fieldset class="types"><legend>I am a</legend>
          ${MEMBER_INFO.map(([k, label, desc, icon]) => `<label class="type-card" for="pfType-${k}"><input type="radio" name="pfType" id="pfType-${k}" value="${k}"${k === type ? " checked" : ""}><span class="tc-ico">${icon}</span><b>${label}</b><span class="note">${desc}</span></label>`).join("")}
        </fieldset>
        <button class="btn" type="submit">Save profile</button>${msgHTML("profileMsg")}
      </form>
      <div class="profile-side">
        <section class="panel side-card"><h2>Access</h2><p><span class="badge ${role}">${ROLE_LABEL[role]}</span></p><p class="note">${access} Access is set by an admin${role === "admin" ? " in People" : ""}.</p></section>
        <form id="passForm" class="panel side-card" novalidate><h2>Change password</h2>
          <label for="pfPass">New password<input id="pfPass" type="password" autocomplete="new-password" minlength="8"></label>
          <button class="btn ghost" type="submit">Update password</button>${msgHTML("passMsg")}</form>
        <button class="btn ghost" type="button" data-signout>${I.logout} Log out</button>
      </div>
    </div>
  </div>`;
}

// Every result in the competition, newest first.
function allResults(c) {
  const out = [];
  for (const s of c.sports) {
    for (const m of s.matches) out.push({ ...m, kind: "match", sport: s });
    for (const e of s.events) out.push({ ...e, kind: "event", sport: s });
  }
  return out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}
function resultLine(c, r) {
  if (r.kind === "event") {
    const w = teamOf(c, r.order[0]);
    return `<span class="feed-main"><b>${esc(r.name)}</b>: ${w ? `${dot(w)}${esc(w.name)} wins` : "result recorded"}</span>`;
  }
  const H = teamOf(c, r.h), A = teamOf(c, r.a); if (!H || !A) return "";
  const hw = r.hs > r.as, aw = r.as > r.hs;
  return `<span class="feed-main"><span class="${hw ? "win" : ""}">${dot(H)}${esc(H.name)}</span> <span class="sc">${num(r.hs)}–${num(r.as)}</span> <span class="${aw ? "win" : ""}">${dot(A)}${esc(A.name)}</span></span>`;
}

function teamView(c, id) {
  const t = teamOf(c, id); if (!t) return "";
  const ov = overallTable(c), me = ov.find(r => r.id === id);
  const label = c.kind === "Intramurals" ? "college" : "team";
  const sportsRows = c.sports.map(s => {
    const tb = sportTable(c, s).filter(r => r.active), r = tb.find(x => x.id === id);
    const pos = r ? tb.indexOf(r) + 1 : null;
    const record = !r ? "Not played yet" : s.format === "placing" ? `${r.e} event${r.e === 1 ? "" : "s"} · ${r.g} first place${r.g === 1 ? "" : "s"}` : `${r.w}W${s.draws ? ` ${r.d}D` : ""} ${r.l}L`;
    return `<tr><td class="team"><button class="team-link" type="button" data-tab="${s.id}">${esc(s.name)}</button></td><td>${pos ? `<span class="${pos <= 3 ? `medal ${["g", "s", "b"][pos - 1]}` : ""}">${ordinal(pos)}</span>` : "–"}</td><td class="team">${record}</td><td class="pts">${r ? num(r.pts) : "–"}</td></tr>`;
  }).join("");
  const mine = allResults(c).filter(r => r.kind === "event" ? r.order.includes(id) : (r.h === id || r.a === id)).slice(0, 10);
  const list = mine.length ? mine.map(r => {
    if (r.kind === "event") { const p = r.order.indexOf(id) + 1; return `<li><span class="feed-main"><b>${ordinal(p)}</b> in ${esc(r.name)}</span><span class="feed-meta">${esc(r.sport.name)} · ${timeAgo(r.at)}</span></li>`; }
    const home = r.h === id, mineS = home ? r.hs : r.as, theirs = home ? r.as : r.hs, opp = teamOf(c, home ? r.a : r.h);
    const res = mineS > theirs ? "W" : mineS < theirs ? "L" : "D";
    return `<li><span class="feed-main"><span class="form"><span class="${res}">${res}</span></span> ${num(mineS)}–${num(theirs)} vs ${opp ? `${dot(opp)}${esc(opp.name)}` : "?"}</span><span class="feed-meta">${esc(r.sport.name)} · ${timeAgo(r.at)}</span></li>`;
  }).join("") : `<li class="empty">No results yet.</li>`;
  return `<div class="home">
    <button class="linkish" type="button" data-tab="overall">← Back to overall</button>
    <section class="panel team-hero">
      <span class="team-hero-mark${t.logo ? " has-logo" : ""}">${t.logo ? `<img src="${esc(t.logo)}" alt="">` : `<span class="step-dot" style="background:${esc(t.color)}"></span>`}</span>
      <div><p class="eyebrow">${me ? `${ordinal(me.pos)} overall` : ""}</p><h2 class="leader-name">${esc(t.name)}</h2>
        <p class="team-medals">${medalCell(me?.g || 0, "g")} gold ${medalCell(me?.sv || 0, "s")} silver ${medalCell(me?.b || 0, "b")} bronze</p></div>
      <div class="leader-pts"><b data-count="${me?.pts || 0}">${num(me?.pts || 0)}</b><span>pts</span></div>
    </section>
    <div class="home-grid">
      <section><div class="sec-head"><h2>By sport</h2><span class="note">This ${label}'s place in each sport</span></div>
        <div class="panel"><div class="table-scroll"><table><thead><tr><th class="team">Sport</th><th>Place</th><th class="team">Record</th><th>Pts</th></tr></thead><tbody>${sportsRows}</tbody></table></div></div></section>
      <aside><div class="sec-head"><h2>Recent results</h2></div><div class="panel"><ul class="list feed">${list}</ul></div></aside>
    </div>
  </div>`;
}

const teamOptions = (c, sel, blank) => (blank ? `<option value="">${blank}</option>` : "") + c.teams.map(t => `<option value="${t.id}"${t.id === sel ? " selected" : ""}>${esc(t.name)}</option>`).join("");
const noTeams = `<div class="panel"><p class="empty">Add at least two teams in Setup first.</p></div>`;

function matchView(c, s) {
  const rows = matchTable(c, s); rows.forEach(r => r.podiumOk = r.active);
  const u = s.unit;
  const cols = [
    { key: "pos", label: "#", cls: "pos" },
    { key: "name", label: "Team", cls: "team", fmt: teamCell },
    { key: "p", label: "P", title: "Played" },
    { key: "w", label: "W", title: "Won" },
    ...(s.draws ? [{ key: "d", label: "D", title: "Drawn" }] : []),
    { key: "l", label: "L", title: "Lost" },
    { key: "f", label: "F", title: `${u} for`, cls: "opt" },
    { key: "a", label: "A", title: `${u} against`, cls: "opt" },
    { key: "diff", label: "+/−", title: `${u} difference`, fmt: r => `<span class="${r.diff > 0 ? "gd-pos" : r.diff < 0 ? "gd-neg" : ""}">${r.diff > 0 ? "+" : ""}${num(r.diff)}</span>` },
    { key: "pts", label: "Pts", cls: "pts", title: "Points" },
    { key: "form", label: "Form", cls: "opt", sortable: false, fmt: r => `<span class="form">${r.formList.slice(-5).map(f => `<span class="${f}" title="${{ W: "Win", D: "Draw", L: "Loss" }[f]}">${f}</span>`).join("")}</span>` },
  ];
  const list = s.matches.length ? [...s.matches].reverse().map(m => {
    const H = teamOf(c, m.h), A = teamOf(c, m.a); if (!H || !A) return "";
    const del = canScore() ? `<button class="x" type="button" data-confirm data-del-result="${m.id}" aria-label="Remove ${esc(H.name)} ${num(m.hs)}–${num(m.as)} ${esc(A.name)}">×</button>` : "<span></span>";
    const by = canScore() && m.by ? `<span class="by">Entered by ${esc(personName(m.by))}</span>` : "";
    return `<li class="match"><span class="h" title="${esc(H.name)}">${esc(H.name)}</span><span class="sc">${num(m.hs)}–${num(m.as)}</span><span class="a" title="${esc(A.name)}">${esc(A.name)}</span>${del}${by}</li>`;
  }).join("") : `<li class="empty">No matches yet.${canScore() ? " Add the first result above." : ""}</li>`;
  const scoring = `Win ${num(s.win)}${s.draws ? `, draw ${num(s.draw)}` : ""}, loss ${num(s.loss)} pts`;
  const form = !canScore() ? "" : `<section><div class="sec-head"><h2>Add a result</h2></div>
    ${c.teams.length < 2 ? noTeams : `<form class="panel" id="matchForm" data-sport="${s.id}" novalidate>
      <div class="score-row"><label for="mHome">Home<select id="mHome">${teamOptions(c, c.teams[0]?.id)}</select></label><label for="mHs">${esc(u)}<input class="score" id="mHs" type="number" min="0" step="any" value="0" inputmode="decimal"></label></div>
      <div class="vs">VS</div>
      <div class="score-row"><label for="mAway">Away<select id="mAway">${teamOptions(c, c.teams[1]?.id)}</select></label><label for="mAs">${esc(u)}<input class="score" id="mAs" type="number" min="0" step="any" value="0" inputmode="decimal"></label></div>
      <button class="btn" type="submit">Save result</button>${msgHTML("matchMsg")}
    </form>`}</section>`;
  return `<div class="layout">
    <section><div class="sec-head"><h2>${esc(s.name)} standings</h2><p class="note">${scoring}. Click a column to sort.</p></div>
      <div class="panel">${tableHTML(s.id, cols, rows)}
      <div class="foot"><span>Ties broken by ${esc(u.toLowerCase())} difference, then ${esc(u.toLowerCase())} scored.</span>${s.draws ? "" : "<span>No draws in this sport.</span>"}</div></div></section>
    <aside>${form}
      <section><div class="sec-head"><h2>Results</h2><span class="note">Latest first</span></div><div class="panel"><ul class="list scroll">${list}</ul></div></section>
    </aside></div>`;
}

function placingView(c, s) {
  const rows = placingTable(c, s); rows.forEach(r => r.podiumOk = r.active);
  const cols = [
    { key: "pos", label: "#", cls: "pos" },
    { key: "name", label: "Team", cls: "team", fmt: teamCell },
    { key: "e", label: "Ev", title: "Events placed in", cls: "opt" },
    { key: "g", label: "1st", fmt: r => medalCell(r.g, "g") },
    { key: "sv", label: "2nd", fmt: r => medalCell(r.sv, "s") },
    { key: "b", label: "3rd", fmt: r => medalCell(r.b, "b") },
    { key: "pts", label: "Pts", cls: "pts", title: "Points from placings" },
  ];
  const slots = Math.min(s.places.length, c.teams.length);
  const selects = Array.from({ length: slots }, (_, i) => `<label for="pl${i}"><span>${ordinal(i + 1)}</span><select id="pl${i}">${teamOptions(c, "", i === 0 ? "Choose winner" : "None")}</select></label>`).join("");
  const list = s.events.length ? [...s.events].reverse().map(ev => {
    const podium = ev.order.slice(0, 3).map((tid, i) => { const t = teamOf(c, tid); return t ? `<span class="medal ${["g", "s", "b"][i]}">${i + 1}</span> ${esc(t.name)}` : ""; }).filter(Boolean).join(" · ");
    const del = canScore() ? `<button class="x" type="button" data-confirm data-del-result="${ev.id}" aria-label="Remove ${esc(ev.name)}">×</button>` : "";
    const by = canScore() && ev.by ? `<div class="sub">Entered by ${esc(personName(ev.by))}</div>` : "";
    return `<li><div class="grow"><div><b>${esc(ev.name)}</b></div><div class="sub">${podium}</div>${by}</div>${del}</li>`;
  }).join("") : `<li class="empty">No events yet.${canScore() ? " Add the first placings above." : ""}</li>`;
  const form = !canScore() ? "" : `<section><div class="sec-head"><h2>Add an event</h2></div>
    ${c.teams.length < 2 ? noTeams : `<form class="panel" id="placingForm" data-sport="${s.id}" novalidate>
      <label for="evName">Event<input id="evName" type="text" maxlength="60" placeholder="e.g. Women's 200 m"></label>
      <div class="places">${selects}</div>
      <button class="btn" type="submit">Save placings</button>${msgHTML("placingMsg")}
    </form>`}</section>`;
  return `<div class="layout">
    <section><div class="sec-head"><h2>${esc(s.name)} standings</h2><p class="note">Points per place: ${s.places.map(num).join(", ")}. Click a column to sort.</p></div>
      <div class="panel">${tableHTML(s.id, cols, rows)}<div class="foot"><span>Ties broken by most 1st places, then 2nd, then 3rd.</span></div></div></section>
    <aside>${form}
      <section><div class="sec-head"><h2>Events</h2><span class="note">Latest first</span></div><div class="panel"><ul class="list scroll">${list}</ul></div></section>
    </aside></div>`;
}

function setupView(c) {
  const teamsList = c.teams.length ? c.teams.map(t => `<li>${dot(t)}<span class="grow">${esc(t.name)}</span>
    <label class="chip upload" tabindex="0" title="Upload a logo for ${esc(t.name)}">${t.logo ? "Change logo" : "Add logo"}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload="team" data-team="${t.id}" hidden></label>
    ${t.logo ? `<button class="x" type="button" data-confirm data-clear-img="team" data-team="${t.id}" aria-label="Remove logo for ${esc(t.name)}" title="Remove logo">⌫</button>` : ""}
    <button class="x" type="button" data-confirm data-del-team="${t.id}" aria-label="Remove ${esc(t.name)}">×</button></li>`).join("") : `<li class="empty">No teams yet.</li>`;
  const sportsList = c.sports.length ? c.sports.map(s => `<li><div class="grow"><div><b>${esc(s.name)}</b></div><div class="sub">${s.format === "placing" ? `Placings · ${s.places.map(num).join("/")} pts` : `Head-to-head · ${esc(s.unit)} · W${num(s.win)}${s.draws ? ` D${num(s.draw)}` : ""} L${num(s.loss)}`}</div></div><button class="x" type="button" data-confirm data-del-sport="${s.id}" aria-label="Remove ${esc(s.name)}">×</button></li>`).join("") : `<li class="empty">No sports yet.</li>`;
  const presetChips = Object.keys(PRESETS).filter(n => !c.sports.some(s => s.name.toLowerCase() === n.toLowerCase())).map(n => `<button class="chip" type="button" data-preset="${esc(n)}">${esc(n)}</button>`).join("");
  return `<div class="setup-grid">
    <section><h2>Teams</h2><p class="note">Colleges, departments, dorms, clubs: anyone who competes.</p>
      <div class="panel"><ul class="list">${teamsList}</ul>
      <form id="teamForm" novalidate style="border-top:1px solid var(--line)"><div class="inline"><input id="teamName" type="text" maxlength="60" placeholder="Team or college name" aria-label="Team or college name"><button class="btn" type="submit">Add</button></div>${msgHTML("teamMsg")}</form></div>
    </section>
    <section><h2>Sports</h2><p class="note">Removing a sport or team also removes its results.</p>
      <div class="panel"><ul class="list">${sportsList}</ul></div>
      <form id="sportForm" class="panel" novalidate>
        ${presetChips ? `<div><p class="note" style="margin-bottom:6px">Quick add</p><div class="chips">${presetChips}</div></div>` : ""}
        <label for="spName">Sport name<input id="spName" type="text" maxlength="40" placeholder="e.g. Sepak Takraw"></label>
        <label for="spFormat">How it's scored<select id="spFormat"><option value="match">Head-to-head matches (team vs team)</option><option value="placing">Placings (1st, 2nd, 3rd in an event)</option></select></label>
        <div id="matchOpts" style="display:grid;gap:10px">
          <label for="spUnit">Score unit<input id="spUnit" type="text" maxlength="16" value="Points"></label>
          <label class="check" for="spDraws"><input id="spDraws" type="checkbox" checked>Draws allowed</label>
          <div class="row3"><label for="spWin">Win pts<input id="spWin" type="number" step="any" value="3"></label><label for="spDraw">Draw pts<input id="spDraw" type="number" step="any" value="1"></label><label for="spLoss">Loss pts<input id="spLoss" type="number" step="any" value="0"></label></div>
        </div>
        <label for="spPlaces" id="placeOpts" hidden>Points per place<input id="spPlaces" type="text" value="10, 8, 6, 5, 4, 3" inputmode="decimal"></label>
        <button class="btn" type="submit">Add sport</button>${msgHTML("sportMsg")}
      </form>
    </section>
    <section><h2>Branding</h2><p class="note">Logos show in the header and next to team names. The background fills the page behind the standings.</p>
      <div class="panel brand-panel">
        <div class="brand-row"><div class="thumb logo-thumb${c.logo ? " filled" : ""}">${c.logo ? `<img src="${esc(c.logo)}" alt="Event logo">` : "<span>No logo</span>"}</div>
          <div class="grow"><b>Event or school logo</b><div class="note">PNG, JPG, WebP or SVG. Square works best.</div>
          <div class="inline"><label class="btn ghost upload" tabindex="0">${c.logo ? "Change" : "Upload"}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload="logo" hidden></label>${c.logo ? `<button class="btn ghost danger" type="button" data-confirm data-clear-img="logo">Remove</button>` : ""}</div></div></div>
        <div class="brand-row"><div class="thumb bg-thumb${c.background ? " filled" : ""}">${c.background ? `<img src="${esc(c.background)}" alt="Page background">` : "<span>No background</span>"}</div>
          <div class="grow"><b>Page background</b><div class="note">A wide photo, like your gym, field or campus.</div>
          <div class="inline"><label class="btn ghost upload" tabindex="0">${c.background ? "Change" : "Upload"}<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="background" hidden></label>${c.background ? `<button class="btn ghost danger" type="button" data-confirm data-clear-img="background">Remove</button>` : ""}</div></div></div>
        ${msgHTML("brandMsg")}
      </div>
    </section>
    <section><h2>Competition</h2>
      <form id="compForm" class="panel" novalidate>
        <label for="cName">Name<input id="cName" type="text" maxlength="80" value="${esc(c.name)}"></label>
        <label for="cKind">Type<select id="cKind">${["Intramurals", "League", "Tournament", "Campus event"].map(k => `<option${k === c.kind ? " selected" : ""}>${k}</option>`).join("")}</select></label>
        <label for="cMedal">Overall points for 1st, 2nd, 3rd…<input id="cMedal" type="text" value="${c.medalPts.map(num).join(", ")}" inputmode="decimal"></label>
        <label for="cAccent">Theme color<span class="inline" style="align-items:center"><input id="cAccent" type="color" value="${esc(c.accent || "#1d6a43")}" style="width:56px;padding:2px"><span class="note">Used for tabs, buttons and highlights.</span></span></label>
        <label class="check" for="cLive"><input id="cLive" type="checkbox"${c.live ? " checked" : ""}>Show live standings on the main login page</label>
        <button class="btn" type="submit">Save changes</button>${msgHTML("compMsg")}
      </form>
      <div class="panel link-panel"><b>Login link</b>
        <p class="note">Share this with the students and coordinators of ${esc(c.name)}. It opens a login page in this competition's colors, and after logging in they only see this competition.</p>
        <div class="inline"><input type="text" readonly value="${esc(compLink(c.id))}" aria-label="Login link" data-no-restore onclick="this.select()"><button class="btn" type="button" data-copy-link="${c.id}">Copy</button></div>
      </div>
      <div class="inline"><button class="btn ghost danger" type="button" data-confirm data-del-comp="${c.id}">Delete this competition</button></div>
    </section>
  </div>`;
}

function peopleView() {
  const q = (msgs.peopleFilter?.text || "").toLowerCase();
  const shown = people.filter(p => !q || [p.full_name, p.email, p.college, MEMBER[p.member_type]].some(x => (x || "").toLowerCase().includes(q)));
  const counts = ["admin", "coordinator", "student"].map(r => `<span><b>${people.filter(p => p.role === r).length}</b> ${ROLE_LABEL[r].toLowerCase()}${people.filter(p => p.role === r).length === 1 ? "" : "s"}</span>`).join("");
  const rows = shown.map(p => `<tr><td><div class="person">${avatar(p)}<div><b>${esc(p.full_name || "No name")}</b><div class="sub note">${esc(p.email)}</div></div></div></td><td class="opt">${MEMBER[p.member_type] ? `<span class="tag">${MEMBER[p.member_type]}</span>` : ""}</td><td class="opt">${esc(p.college)}</td>
    <td><select data-role-for="${p.id}" aria-label="Role for ${esc(p.full_name || p.email)}">${["student", "coordinator", "admin"].map(r => `<option value="${r}"${p.role === r ? " selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select></td></tr>`).join("")
    || `<tr><td colspan="4" class="empty">No one matches that search.</td></tr>`;
  return `<section style="display:grid;gap:10px">
    <div class="sec-head"><h2>People</h2><div class="meta">${counts}</div></div>
    <p class="note">Everyone who signs up starts as a viewer, who can follow standings. Make sports coordinators here so they can enter scores. "I am a" is what people chose for themselves.</p>
    <input id="peopleSearch" type="search" placeholder="Search by name, email or college" aria-label="Search people" value="${esc(msgs.peopleFilter?.text || "")}">
    ${msgHTML("peopleMsg")}
    <div class="panel"><div class="table-scroll"><table class="people"><thead><tr><th class="team">Person</th><th class="team opt">I am a</th><th class="team opt">College</th><th class="team">Access</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  </section>`;
}

/* ---------- branding ---------- */
function applyBranding(c) {
  const root = document.documentElement;
  if (c && c.accent) { root.style.setProperty("--brand", c.accent); root.classList.add("branded"); }
  else { root.style.removeProperty("--brand"); root.classList.remove("branded"); }
  let bg = document.querySelector(".page-bg");
  if (c && c.background) {
    if (!bg) { bg = document.createElement("div"); bg.className = "page-bg"; document.body.prepend(bg); }
    bg.style.backgroundImage = `url("${encodeURI(c.background)}")`;
    document.body.classList.add("has-bg");
  } else { bg?.remove(); document.body.classList.remove("has-bg"); }
  const logo = $("eventLogo");
  if (logo) { if (c && c.logo) { if (logo.getAttribute("src") !== c.logo) logo.src = c.logo; logo.alt = `${c.name} logo`; logo.hidden = false; } else logo.hidden = true; }
  const icon = document.querySelector('link[rel="icon"]');
  if (c && c.logo) { const l = icon || Object.assign(document.createElement("link"), { rel: "icon" }); l.href = c.logo; if (!icon) document.head.append(l); }
}

// Shrinks an image in the browser before upload: logos to 512px PNG (keeps transparency), backgrounds to 1920px JPEG.
function prepareImage(file, kind) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return reject(new Error("Choose a PNG, JPG, WebP or SVG image."));
    if (file.size > 15 * 1024 * 1024) return reject(new Error("That image is over 15 MB. Choose a smaller one."));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = kind === "background" ? 1920 : kind === "avatar" ? 400 : 512;
      const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512, scale = Math.min(1, max / Math.max(w0, h0));
      const cv = document.createElement("canvas"); cv.width = Math.round(w0 * scale); cv.height = Math.round(h0 * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      const type = kind === "background" ? "image/jpeg" : "image/png";
      cv.toBlob(b => b ? resolve({ blob: b, type, ext: type === "image/png" ? "png" : "jpg" }) : reject(new Error("Couldn't read that image.")), type, 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image. Try a PNG or JPG.")); };
    img.src = url;
  });
}
const storagePath = url => { const i = (url || "").indexOf("/branding/"); return i < 0 ? null : decodeURIComponent(url.slice(i + 10).split("?")[0]); };

async function uploadImage(kind, file, teamId) {
  const c = comp(); if (!c) return;
  const msgId = kind === "team" ? "teamMsg" : "brandMsg";
  setMsg(msgId, "Uploading…", true);
  try {
    const { blob, type, ext } = await prepareImage(file, kind);
    const path = `${c.id}/${kind === "team" ? "teams/" + teamId : kind}-${Date.now().toString(36)}.${ext}`;
    const { error: upErr } = await sb.storage.from("branding").upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
    if (upErr) throw upErr;
    const url = sb.storage.from("branding").getPublicUrl(path).data.publicUrl;
    const old = kind === "team" ? c.teams.find(t => t.id === teamId)?.logo : kind === "logo" ? c.logo : c.background;
    const { error } = kind === "team"
      ? await sb.from("teams").update({ logo_url: url }).eq("id", teamId)
      : await sb.from("competitions").update({ [kind === "logo" ? "logo_url" : "background_url"]: url }).eq("id", c.id);
    if (error) throw error;
    if (storagePath(old)) sb.storage.from("branding").remove([storagePath(old)]);
    setMsg(msgId, kind === "team" ? "Team logo saved." : kind === "logo" ? "Event logo saved." : "Background saved.", true);
  } catch (e) { setMsg(msgId, e.statusCode === "403" || e.code === "42501" ? "Only admins can upload images." : e.message || "Upload failed. Try again."); }
  await refresh();
}
async function clearImage(kind, teamId) {
  const c = comp(); if (!c) return null;
  const old = kind === "team" ? c.teams.find(t => t.id === teamId)?.logo : kind === "logo" ? c.logo : c.background;
  const { error } = kind === "team"
    ? await sb.from("teams").update({ logo_url: null }).eq("id", teamId)
    : await sb.from("competitions").update({ [kind === "logo" ? "logo_url" : "background_url"]: null }).eq("id", c.id);
  if (!error && storagePath(old)) sb.storage.from("branding").remove([storagePath(old)]);
  return error;
}

const avatarPath = url => { const i = (url || "").indexOf("/avatars/"); return i < 0 ? null : decodeURIComponent(url.slice(i + 9).split("?")[0]); };
async function uploadAvatar(file) {
  setMsg("avatarMsg", "Uploading…", true);
  try {
    const { blob, type, ext } = await prepareImage(file, "avatar");
    const path = `${session.user.id}/avatar-${Date.now().toString(36)}.${ext}`;
    const { error: upErr } = await sb.storage.from("avatars").upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
    if (upErr) throw upErr;
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl, old = me?.avatar_url;
    const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", session.user.id);
    if (error) throw error;
    if (avatarPath(old)) sb.storage.from("avatars").remove([avatarPath(old)]);
    setMsg("avatarMsg", "Photo saved.", true);
  } catch (e) { setMsg("avatarMsg", e.message || "Upload failed. Try again."); }
  await loadProfile(); await refresh();
}

/* ---------- actions ---------- */
function armed(btn) {
  if (btn.hasAttribute("data-armed")) return true;
  btn.setAttribute("data-armed", ""); btn.dataset.label = btn.innerHTML; btn.textContent = "Confirm";
  setTimeout(() => { if (btn.isConnected) { btn.removeAttribute("data-armed"); btn.innerHTML = btn.dataset.label; } }, 3000);
  return false;
}
async function newComp() {
  const { data, error } = await sb.from("competitions").insert({ name: "New competition", kind: "Intramurals" }).select().single();
  if (error) return showBanner(errText(error));
  currentId = data.id; view = "setup"; rememberUi(); if (linkComp) setLink(currentId); await refresh();
  if ($("cName")) { $("cName").focus(); $("cName").select(); }
}
async function addSport(c, name, over) {
  const p = { ...(PRESETS[name] || { format: "match", draws: true, win: 3, draw: 1, loss: 0, unit: "Points", places: [10, 8, 6, 5, 4, 3] }), ...over };
  const { error } = await sb.from("sports").insert({
    competition_id: c.id, name, format: p.format, draws: !!p.draws, win_points: p.win ?? 3, draw_points: p.draw ?? 1, loss_points: p.loss ?? 0,
    unit: p.unit || "Points", place_points: p.places || [10, 8, 6, 5, 4, 3],
  });
  if (error) return setMsg("sportMsg", errText(error));
  setMsg("sportMsg", `Added ${name}. It now has its own tab.`, true); await refresh();
}

function closePanels(except) {
  if (except !== "notif") { const n = $("notifPanel"); if (n && !n.hidden) { n.hidden = true; document.querySelector("[data-bell]")?.setAttribute("aria-expanded", "false"); } }
  if (except !== "search") { const r = $("searchResults"); if (r) r.hidden = true; if (!$("globalSearch")?.value) document.body.classList.remove("searching"); }
}

document.addEventListener("click", async e => {
  const t = e.target;
  if (!t.closest(".bell-wrap")) closePanels(t.closest("#searchBox") ? "search" : null);
  else if (!t.closest("#searchBox")) closePanels("notif");
  if (t.closest("[data-toggle-nav]")) {
    if (matchMedia("(max-width: 1023px)").matches) document.body.classList.toggle("nav-open");
    else { document.body.classList.toggle("nav-mini"); try { localStorage.setItem("sl-mini", document.body.classList.contains("nav-mini") ? "1" : ""); } catch (err) {} }
    return;
  }
  if (t.closest("[data-close-nav]")) return document.body.classList.remove("nav-open");
  if (t.closest("[data-open-search]")) { document.body.classList.add("searching"); return $("globalSearch")?.focus(); }
  if (t.closest("[data-bell]")) {
    const c = comp(), panel = $("notifPanel"); if (!c || !panel) return;
    const open = panel.hidden;
    panel.hidden = !open; t.closest("[data-bell]").setAttribute("aria-expanded", String(open));
    if (open) { panel.innerHTML = notifHTML(c); const latest = allResults(c)[0]?.at; if (latest) markSeen(latest); paintBell(c); }
    return;
  }
  const rf = t.closest("[data-rfilter]");
  if (rf) { resultsFilter = rf.dataset.rfilter; return render(); }
  const au = t.closest("[data-auth]");
  if (au) { authMode = au.dataset.auth; delete msgs.authMsg; return authScreen(); }
  const pub = t.closest("[data-pub]");
  if (pub) { publicIdx = +pub.dataset.pub; return paintPublic(); }
  const oc = t.closest("[data-open-comp]");
  if (oc) {
    setLink(oc.dataset.openComp); currentId = linkComp; view = "overall"; rememberUi(); paintPublic();
    document.querySelector(".auth-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.closest("[data-all-comps]")) { setLink(null); await loadPublic(); return paintPublic(); }
  if (t.closest("[data-copy-link]")) {
    const link = compLink(t.closest("[data-copy-link]").dataset.copyLink);
    try { await navigator.clipboard.writeText(link); toast("Login link copied. Share it with this competition's students and coordinators."); }
    catch (err) { toast(link); }
    return;
  }
  if (t.closest("[data-signout]")) { await sb.auth.signOut(); return; }
  if (t.closest("[data-share]")) {
    const link = currentId ? compLink(currentId) : location.origin + location.pathname;
    try { await navigator.clipboard.writeText(link); toast("Link copied. Anyone who opens it can sign up and follow this competition."); }
    catch (err) { toast(link); }
    return;
  }
  const tab = t.closest("[data-tab]");
  if (tab) {
    view = tab.dataset.tab; Object.keys(msgs).forEach(k => delete msgs[k]); rememberUi();
    document.body.classList.remove("nav-open"); closeSearch(); closePanels();
    render(); window.scrollTo({ top: 0 }); return;
  }
  const so = t.closest("[data-sort]");
  if (so) {
    const k = so.dataset.sort, vk = so.dataset.view, cur = sorts[vk] || { key: "pos", dir: "asc" };
    sorts[vk] = cur.key === k ? { key: k, dir: cur.dir === "asc" ? "desc" : "asc" } : { key: k, dir: ["pos", "name", "l", "a"].includes(k) ? "asc" : "desc" };
    return render();
  }
  if (t.closest("[data-new-comp]") && canSetup()) return newComp();
  const ca = t.closest("[data-clear-avatar]");
  if (ca) {
    if (!armed(ca)) return;
    const old = me?.avatar_url;
    const { error } = await sb.from("profiles").update({ avatar_url: null }).eq("id", session.user.id);
    if (error) return setMsg("avatarMsg", errText(error));
    if (avatarPath(old)) sb.storage.from("avatars").remove([avatarPath(old)]);
    await loadProfile(); return render();
  }
  const c = comp(); if (!c) return;
  const pr = t.closest("[data-preset]");
  if (pr && canSetup()) return addSport(c, pr.dataset.preset, {});
  const cf = t.closest("[data-confirm]");
  if (!cf || !armed(cf)) return;
  let error;
  if (cf.dataset.delResult && canScore()) {
    const r = results.find(x => x.id === cf.dataset.delResult);
    flashIds = r ? (r.placings || [r.home_team, r.away_team]) : [];
    ({ error } = await sb.from("results").delete().eq("id", cf.dataset.delResult));
  } else if (cf.dataset.delTeam && canSetup()) {
    ({ error } = await sb.from("teams").delete().eq("id", cf.dataset.delTeam));
    if (!error) setMsg("teamMsg", "Team removed.", true);
  } else if (cf.dataset.delSport && canSetup()) {
    ({ error } = await sb.from("sports").delete().eq("id", cf.dataset.delSport));
    if (!error) setMsg("sportMsg", "Sport removed.", true);
  } else if (cf.dataset.clearImg && canSetup()) {
    error = await clearImage(cf.dataset.clearImg, cf.dataset.team);
  } else if (cf.dataset.delComp && canSetup()) {
    ({ error } = await sb.from("competitions").delete().eq("id", cf.dataset.delComp));
    if (!error) { currentId = null; view = "overall"; rememberUi(); }
  }
  if (error) showBanner(errText(error));
  await refresh();
});

// The login screen moves to the next competition when its progress bar fills (paused on hover or focus).
document.addEventListener("animationend", e => {
  if (!e.target.matches?.(".rotate-bar span") || session) return;
  const n = publicList().length; if (n < 2 || linkComp) return;
  publicIdx = (publicIdx + 1) % n; paintPublic();
});

document.addEventListener("keydown", e => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (e.key === "/" && !typing && $("globalSearch")) { e.preventDefault(); document.body.classList.add("searching"); return $("globalSearch").focus(); }
  if (e.key === "Escape") { closeSearch(); closePanels(); document.body.classList.remove("nav-open"); return; }
  if (e.key === "Enter" && e.target.id === "globalSearch") { e.preventDefault(); return document.querySelector("#searchResults .sr-item")?.click(); }
  const l = e.target.closest?.("label.upload");
  if (l && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); l.querySelector("input")?.click(); }
});

document.addEventListener("input", e => {
  if (e.target.id === "globalSearch") return paintSearch();
  if (e.target.id === "peopleSearch") {
    msgs.peopleFilter = { text: e.target.value };
    const pos = e.target.selectionStart; render(); const el = $("peopleSearch"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
});

document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "compSelect") {
    if (t.value === "__new") return newComp();
    currentId = t.value; view = "overall"; rememberUi();
    if (linkComp) setLink(currentId);
    return refresh();
  }
  if (t.id === "spFormat" || t.id === "spDraws") return applySportFormat();
  if (t.dataset.upload === "avatar" && t.files[0]) return uploadAvatar(t.files[0]);
  if (t.dataset.upload && canSetup() && t.files[0]) return uploadImage(t.dataset.upload, t.files[0], t.dataset.team);
  if (t.dataset.roleFor && canSetup()) {
    const p = people.find(x => x.id === t.dataset.roleFor);
    const { error } = await sb.from("profiles").update({ role: t.value }).eq("id", t.dataset.roleFor);
    if (error) setMsg("peopleMsg", errText(error));
    else setMsg("peopleMsg", `${p?.full_name || p?.email || "They"} ${p?.full_name || p?.email ? "is" : "are"} now ${t.value === "admin" ? "an admin" : "a " + t.value}.`, true);
    await refresh();
  }
});

document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;

  /* sign in */
  if (f.id === "loginForm") {
    introPending = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("aEmail").value.trim(), password: $("aPass").value });
    if (error) introPending = false;
    if (error) setMsg("authMsg", error.message === "Invalid login credentials" ? "That email and password don't match an account." : error.message);
    return;
  }
  if (f.id === "signupForm") {
    const full_name = $("aName").value.trim(), college = $("aCollege").value.trim(), email = $("aEmail").value.trim(), password = $("aPass").value;
    if (!full_name) return setMsg("authMsg", "Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("authMsg", "Enter a valid email address.");
    if (password.length < 8) return setMsg("authMsg", "Use a password with at least 8 characters.");
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, college, member_type: $("aType").value }, emailRedirectTo: location.origin + location.pathname } });
    if (error) return setMsg("authMsg", error.message);
    if (!data.session) setMsg("authMsg", `Check ${email} for a link to confirm your account, then log in.`, true);
    return;
  }
  if (f.id === "forgotForm") {
    const email = $("fEmail").value.trim();
    if (!email) return setMsg("authMsg", "Enter your email.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    return error ? setMsg("authMsg", error.message) : setMsg("authMsg", `If ${email} has an account, a reset link is on its way.`, true);
  }
  if (f.id === "newPassForm") {
    const password = $("newPass").value;
    if (password.length < 8) return setMsg("authMsg", "Use a password with at least 8 characters.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) return setMsg("authMsg", error.message);
    recovering = false; delete msgs.authMsg; return start();
  }

  if (f.id === "profileForm") {
    const full_name = $("pfName").value.trim().replace(/\s+/g, " "), college = $("pfCollege").value.trim();
    const member_type = f.querySelector('input[name="pfType"]:checked')?.value || "student";
    if (!full_name) return setMsg("profileMsg", "Enter your full name.");
    const { error } = await sb.from("profiles").update({ full_name, college, member_type }).eq("id", session.user.id);
    if (error) return setMsg("profileMsg", errText(error));
    setMsg("profileMsg", "Profile saved.", true); await loadProfile(); return refresh();
  }
  if (f.id === "passForm") {
    const password = $("pfPass").value;
    if (password.length < 8) return setMsg("passMsg", "Use a password with at least 8 characters.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) return setMsg("passMsg", error.message);
    $("pfPass").value = ""; return setMsg("passMsg", "Password updated.", true);
  }

  const c = comp(); if (!c) return;
  if (f.id === "matchForm" && canScore()) {
    const s = c.sports.find(x => x.id === f.dataset.sport);
    const h = $("mHome").value, a = $("mAway").value, hs = Number($("mHs").value), as = Number($("mAs").value);
    if (h === a) return setMsg("matchMsg", "Pick two different teams.");
    if ($("mHs").value === "" || $("mAs").value === "" || ![hs, as].every(n => Number.isFinite(n) && n >= 0)) return setMsg("matchMsg", "Scores must be zero or more.");
    if (!s.draws && hs === as) return setMsg("matchMsg", `${s.name} has no draws. Enter the final score with a winner.`);
    const { error } = await sb.from("results").insert({ competition_id: c.id, sport_id: s.id, kind: "match", home_team: h, away_team: a, home_score: hs, away_score: as });
    if (error) return setMsg("matchMsg", errText(error));
    $("mHs").value = 0; $("mAs").value = 0; flashIds = [h, a];
    setMsg("matchMsg", `Saved ${teamOf(c, h).name} ${num(hs)}–${num(as)} ${teamOf(c, a).name}.`, true);
    return refresh();
  }
  if (f.id === "placingForm" && canScore()) {
    const s = c.sports.find(x => x.id === f.dataset.sport);
    const name = $("evName").value.trim();
    const order = [...f.querySelectorAll(".places select")].map(x => x.value);
    const picked = order.slice(0, order.map(Boolean).lastIndexOf(true) + 1);
    if (!name) return setMsg("placingMsg", "Name the event, for example Men's 400 m.");
    if (!picked[0]) return setMsg("placingMsg", "Choose who finished 1st.");
    if (picked.some(x => !x)) return setMsg("placingMsg", "Fill places in order without gaps.");
    if (new Set(picked).size !== picked.length) return setMsg("placingMsg", "A team can only take one place per event.");
    const { error } = await sb.from("results").insert({ competition_id: c.id, sport_id: s.id, kind: "event", event_name: name, placings: picked });
    if (error) return setMsg("placingMsg", errText(error));
    $("evName").value = ""; f.querySelectorAll(".places select").forEach(x => x.value = ""); flashIds = picked;
    setMsg("placingMsg", `Saved ${name}.`, true);
    return refresh();
  }
  if (!canSetup()) return;
  if (f.id === "teamForm") {
    const name = $("teamName").value.trim().replace(/\s+/g, " ");
    if (!name) return setMsg("teamMsg", "Type a team or college name.");
    if (c.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) return setMsg("teamMsg", `${name} is already in this competition.`);
    const used = new Set(c.teams.map(t => t.color));
    const { error } = await sb.from("teams").insert({ competition_id: c.id, name, color: PALETTE.find(p => !used.has(p)) || PALETTE[c.teams.length % PALETTE.length] });
    if (error) return setMsg("teamMsg", errText(error));
    $("teamName").value = ""; setMsg("teamMsg", `Added ${name}.`, true);
    await refresh(); $("teamName")?.focus();
  }
  if (f.id === "sportForm") {
    const name = $("spName").value.trim().replace(/\s+/g, " ");
    if (!name) return setMsg("sportMsg", "Type a sport name, or tap one under Quick add.");
    if (c.sports.some(s => s.name.toLowerCase() === name.toLowerCase())) return setMsg("sportMsg", `${name} is already added.`);
    if ($("spFormat").value === "placing") {
      const places = parseList($("spPlaces").value);
      if (!places) return setMsg("sportMsg", "Points per place must be numbers, like 10, 8, 6.");
      $("spName").value = ""; return addSport(c, name, { format: "placing", places });
    }
    const win = Number($("spWin").value), draw = Number($("spDraw").value), loss = Number($("spLoss").value);
    if (![win, draw, loss].every(Number.isFinite)) return setMsg("sportMsg", "Points for win, draw and loss must be numbers.");
    $("spName").value = "";
    return addSport(c, name, { format: "match", unit: $("spUnit").value.trim() || "Points", draws: $("spDraws").checked, win, draw, loss });
  }
  if (f.id === "compForm") {
    const name = $("cName").value.trim(), medal = parseList($("cMedal").value);
    if (!name) return setMsg("compMsg", "Give the competition a name.");
    if (!medal) return setMsg("compMsg", "Overall points must be numbers, like 5, 3, 1.");
    const { error } = await sb.from("competitions").update({ name, kind: $("cKind").value, medal_points: medal, accent_color: $("cAccent").value, is_live: $("cLive").checked }).eq("id", c.id);
    if (error) return setMsg("compMsg", errText(error));
    setMsg("compMsg", "Saved.", true); await refresh();
  }
});

/* ---------- start ---------- */
let channel = null;
async function start() {
  if (!session) { if (channel) { sb.removeChannel(channel); channel = null; } shellReady = false; return authScreen(); }
  const intro = introPending ? introOverlay() : null; introPending = false;
  stopPublicFeed();
  await loadProfile();
  await loadAll();
  render();
  if (intro) runIntro(intro, comp());
  if (!channel) channel = sb.channel("live").on("postgres_changes", { event: "*", schema: "public" }, scheduleReload)
    .subscribe(status => { const on = status === "SUBSCRIBED"; if (on !== liveOn) { liveOn = on; if (shellReady) render(); if (on) scheduleReload(); } });
}

try { if (localStorage.getItem("sl-mini")) document.body.classList.add("nav-mini"); } catch (e) {}
if (!sb) setupNeededScreen();
else {
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "PASSWORD_RECOVERY") { session = s; recovering = true; return authScreen(); }
    if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") { session = s; return; }
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed || event === "INITIAL_SESSION") setTimeout(start);
  });
}
