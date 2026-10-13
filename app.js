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
const ROLE_LABEL = { admin: "Admin", coordinator: "Coordinator", student: "Student" };

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const dot = t => `<span class="swatch" style="background:${esc(t.color || "#888")}"></span>`;
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
    const { data } = await sb.from("profiles").select("id, full_name, email, college, role, created_at").order("created_at");
    people = data || [];
  }
}
let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(async () => { await loadAll(); render(); }, 250); }
async function refresh() { await loadAll(); render(); }

function comp() {
  const raw = comps.find(c => c.id === currentId); if (!raw) return null;
  const c = {
    id: raw.id, name: raw.name, kind: raw.kind, medalPts: (raw.medal_points || [5, 3, 1]).map(Number),
    teams: teams.map(t => ({ id: t.id, name: t.name, color: t.color })),
    sports: sports.map(s => ({ id: s.id, name: s.name, format: s.format, draws: s.draws, win: +s.win_points, draw: +s.draw_points, loss: +s.loss_points, unit: s.unit, places: (s.place_points || []).map(Number), matches: [], events: [] })),
  };
  for (const r of results) {
    const s = c.sports.find(x => x.id === r.sport_id); if (!s) continue;
    if (r.kind === "event") s.events.push({ id: r.id, name: r.event_name, order: r.placings || [], by: r.entered_by });
    else s.matches.push({ id: r.id, h: r.home_team, a: r.away_team, hs: +r.home_score, as: +r.away_score, by: r.entered_by });
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
    return `<tr class="${podium}${flashIds.includes(r.id) ? " flash" : ""}">${cols.map(c => `<td class="${c.cls || ""}">${c.fmt ? c.fmt(r) : esc(num(r[c.key]))}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const teamCell = r => `${dot(r.team)}${esc(r.name)}`;
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
        <label for="aCollege">College or department<input id="aCollege" type="text" maxlength="80" placeholder="e.g. College of Engineering"></label>` : ""}
        <label for="aEmail">Email<input id="aEmail" type="email" autocomplete="email"></label>
        <label for="aPass">Password<input id="aPass" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8"></label>
        <button class="btn" type="submit">${signup ? "Create account" : "Log in"}</button>${msgHTML("authMsg")}
        ${signup ? `<p class="note">New accounts start as students, who can view standings. An admin can make you a coordinator.</p>` : `<button class="linkish" type="button" data-auth="forgot">Forgot password?</button>`}
      </form>`;
  $("root").innerHTML = `<div class="auth"><div class="auth-card">
    <div><p class="eyebrow">Scoreboard</p><h1>Sports Leaderboard</h1></div>
    <div class="panel">${form}</div>
  </div></div>`;
}

function buildShell() {
  $("root").innerHTML = `<div class="wrap">
    <header>
      <div><p class="eyebrow" id="eyebrow">Scoreboard</p><h1 id="title">Sports Leaderboard</h1></div>
      <div style="display:grid;gap:8px;justify-items:start">
        <div class="who" id="who"></div>
        <div class="switcher" id="switcher" hidden><label for="compSelect">Competition</label><select id="compSelect" style="width:auto;max-width:100%"></select></div>
        <div class="meta" id="meta"></div>
      </div>
    </header>
    <div class="banner" id="banner" hidden></div>
    <nav class="tabs" id="tabs" role="tablist" aria-label="Views"></nav>
    <main id="view"></main>
  </div>`;
  shellReady = true; lastRenderedView = null;
}
function showBanner(text) { const b = $("banner"); if (b) { b.hidden = false; b.textContent = text; } }

function render() {
  if (!session) return authScreen();
  if (!shellReady) buildShell();
  const keep = captureForm();
  const c = comp();
  $("who").innerHTML = `<span class="badge ${role}">${ROLE_LABEL[role]}</span><span>${esc(me?.full_name || session.user.email)}</span><button class="linkish" type="button" data-signout>Log out</button>`;
  $("switcher").hidden = !(comps.length > 1 || canSetup());
  $("compSelect").innerHTML = comps.map(x => `<option value="${x.id}"${x.id === currentId ? " selected" : ""}>${esc(x.name)}</option>`).join("") + (canSetup() ? `<option value="__new">+ New competition…</option>` : "");

  if (!c) {
    $("eyebrow").textContent = "Scoreboard"; $("title").textContent = "Sports Leaderboard"; $("meta").innerHTML = "";
    $("tabs").innerHTML = canSetup() ? `<button class="tab" role="tab" type="button" data-tab="overall" aria-selected="${view !== "people"}">Start</button><button class="tab setup" role="tab" type="button" data-tab="people" aria-selected="${view === "people"}">People</button>` : "";
    $("view").innerHTML = view === "people" && canSetup() ? peopleView()
      : canSetup() ? `<div class="panel" style="display:grid;gap:12px;padding:16px;justify-items:start"><h2>Start your first competition</h2><p class="note">Create an intramurals event, league or tournament. Then add colleges or teams and the sports they play.</p><button class="btn" type="button" data-new-comp>Create competition</button></div>`
      : `<div class="panel"><p class="empty">No competitions yet. Check back when the organizers have set one up.</p></div>`;
    return;
  }
  if ((view === "setup" || view === "people") && !canSetup()) view = "overall";
  if (!["overall", "setup", "people"].includes(view) && !c.sports.some(s => s.id === view)) view = "overall";

  $("eyebrow").textContent = `${c.kind || "Competition"} · ${c.sports.length} sport${c.sports.length === 1 ? "" : "s"}`;
  $("title").textContent = c.name;
  const played = c.sports.reduce((n, s) => n + s.matches.length + s.events.length, 0);
  $("meta").innerHTML = `<span><b>${c.teams.length}</b> teams</span><span><b>${played}</b> results</span>`;
  const tabs = [["overall", "Overall"], ...c.sports.map(s => [s.id, s.name]), ...(canSetup() ? [["setup", "Setup"], ["people", "People"]] : [])];
  $("tabs").innerHTML = tabs.map(([id, label]) => `<button class="tab${id === "setup" ? " setup" : ""}" role="tab" type="button" data-tab="${id}" aria-selected="${view === id}">${esc(label)}</button>`).join("");

  const v = $("view");
  if (view === "overall") v.innerHTML = overallView(c);
  else if (view === "setup") v.innerHTML = setupView(c);
  else if (view === "people") v.innerHTML = peopleView();
  else { const s = c.sports.find(x => x.id === view); v.innerHTML = s.format === "placing" ? placingView(c, s) : matchView(c, s); }
  if (lastRenderedView === view + currentId) restoreForm(keep);
  lastRenderedView = view + currentId;
  applySportFormat();
  if (flashIds.length) { flashIds = []; setTimeout(() => document.querySelectorAll("tr.flash").forEach(t => t.classList.remove("flash")), 1200); }
}

function captureForm() {
  const o = {};
  document.querySelectorAll("#view input, #view select").forEach(el => { if (el.id) o[el.id] = el.type === "checkbox" ? el.checked : el.value; });
  return { o, focus: document.activeElement && document.activeElement.id };
}
function restoreForm(k) {
  for (const [id, val] of Object.entries(k.o)) {
    const el = $(id); if (!el || el.dataset.noRestore !== undefined) continue;
    if (el.type === "checkbox") el.checked = val;
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
  if (!c.teams.length || !c.sports.length) return `<div class="panel"><p class="empty">${canSetup() ? `Add teams and sports in <button class="chip" data-tab="setup" type="button">Setup</button> to start the leaderboard.` : "The organizers are still adding teams and sports."}</p></div>`;
  const rows = overallTable(c); rows.forEach(r => r.podiumOk = r.pts > 0);
  const cols = [
    { key: "pos", label: "#", cls: "pos" },
    { key: "name", label: c.kind === "Intramurals" ? "College" : "Team", cls: "team", fmt: teamCell },
    { key: "g", label: "Gold", fmt: r => medalCell(r.g, "g") },
    { key: "sv", label: "Silver", fmt: r => medalCell(r.sv, "s") },
    { key: "b", label: "Bronze", fmt: r => medalCell(r.b, "b") },
    { key: "sports", label: "Sports", cls: "opt", title: "Sports with at least one result" },
    { key: "pts", label: "Pts", cls: "pts", title: "Overall points" },
  ];
  const cards = c.sports.map(s => {
    const t = sportTable(c, s).filter(r => r.active);
    const n = s.format === "placing" ? s.events.length : s.matches.length;
    const lead = t[0] ? `${dot(t[0].team)}${esc(t[0].name)}` : "No results yet";
    return `<button class="card" type="button" data-tab="${s.id}"><span class="k">${esc(s.name)}</span><span class="v">${lead}</span><span class="sub">${n} ${s.format === "placing" ? (n === 1 ? "event" : "events") : (n === 1 ? "match" : "matches")} · ${s.format === "placing" ? "placings" : "head-to-head"}</span></button>`;
  }).join("");
  return `<div style="display:grid;gap:22px">
    <section><div class="sec-head"><h2>Overall standings</h2><p class="note">Each sport's current top 3 earn gold, silver, bronze. Points ${c.medalPts.map((p, i) => `${ordinal(i + 1)} ${num(p)}`).join(", ")}.</p></div>
    <div class="panel">${tableHTML("overall", cols, rows)}</div></section>
    <section><div class="sec-head"><h2>Sports</h2><p class="note">Pick a sport to see its table${canScore() ? " and enter results" : ""}.</p></div><div class="cards">${cards}</div></section>
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
  const teamsList = c.teams.length ? c.teams.map(t => `<li>${dot(t)}<span class="grow">${esc(t.name)}</span><button class="x" type="button" data-confirm data-del-team="${t.id}" aria-label="Remove ${esc(t.name)}">×</button></li>`).join("") : `<li class="empty">No teams yet.</li>`;
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
    <section><h2>Competition</h2>
      <form id="compForm" class="panel" novalidate>
        <label for="cName">Name<input id="cName" type="text" maxlength="80" value="${esc(c.name)}"></label>
        <label for="cKind">Type<select id="cKind">${["Intramurals", "League", "Tournament", "Campus event"].map(k => `<option${k === c.kind ? " selected" : ""}>${k}</option>`).join("")}</select></label>
        <label for="cMedal">Overall points for 1st, 2nd, 3rd…<input id="cMedal" type="text" value="${c.medalPts.map(num).join(", ")}" inputmode="decimal"></label>
        <button class="btn" type="submit">Save changes</button>${msgHTML("compMsg")}
      </form>
      <div class="inline"><button class="btn ghost danger" type="button" data-confirm data-del-comp="${c.id}">Delete this competition</button></div>
    </section>
  </div>`;
}

function peopleView() {
  const q = (msgs.peopleFilter?.text || "").toLowerCase();
  const shown = people.filter(p => !q || [p.full_name, p.email, p.college].some(x => (x || "").toLowerCase().includes(q)));
  const counts = ["admin", "coordinator", "student"].map(r => `<span><b>${people.filter(p => p.role === r).length}</b> ${ROLE_LABEL[r].toLowerCase()}${people.filter(p => p.role === r).length === 1 ? "" : "s"}</span>`).join("");
  const rows = shown.map(p => `<tr><td><b>${esc(p.full_name || "No name")}</b><div class="sub note">${esc(p.email)}</div></td><td class="opt">${esc(p.college)}</td>
    <td><select data-role-for="${p.id}" aria-label="Role for ${esc(p.full_name || p.email)}">${["student", "coordinator", "admin"].map(r => `<option value="${r}"${p.role === r ? " selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select></td></tr>`).join("")
    || `<tr><td colspan="3" class="empty">No one matches that search.</td></tr>`;
  return `<section style="display:grid;gap:10px">
    <div class="sec-head"><h2>People</h2><div class="meta">${counts}</div></div>
    <p class="note">Everyone who signs up starts as a student. Make sports coordinators here so they can enter scores. Changes apply the next time they load the page.</p>
    <input id="peopleSearch" type="search" placeholder="Search by name, email or college" aria-label="Search people" value="${esc(msgs.peopleFilter?.text || "")}">
    ${msgHTML("peopleMsg")}
    <div class="panel"><div class="table-scroll"><table class="people"><thead><tr><th class="team">Person</th><th class="team opt">College</th><th class="team">Role</th></tr></thead><tbody>${rows}</tbody></table></div></div>
  </section>`;
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
  currentId = data.id; view = "setup"; rememberUi(); await refresh();
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

document.addEventListener("click", async e => {
  const t = e.target;
  const au = t.closest("[data-auth]");
  if (au) { authMode = au.dataset.auth; delete msgs.authMsg; return authScreen(); }
  if (t.closest("[data-signout]")) { await sb.auth.signOut(); return; }
  const tab = t.closest("[data-tab]");
  if (tab) { view = tab.dataset.tab; Object.keys(msgs).forEach(k => delete msgs[k]); rememberUi(); render(); window.scrollTo({ top: 0 }); return; }
  const so = t.closest("[data-sort]");
  if (so) {
    const k = so.dataset.sort, vk = so.dataset.view, cur = sorts[vk] || { key: "pos", dir: "asc" };
    sorts[vk] = cur.key === k ? { key: k, dir: cur.dir === "asc" ? "desc" : "asc" } : { key: k, dir: ["pos", "name", "l", "a"].includes(k) ? "asc" : "desc" };
    return render();
  }
  if (t.closest("[data-new-comp]") && canSetup()) return newComp();
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
  } else if (cf.dataset.delComp && canSetup()) {
    ({ error } = await sb.from("competitions").delete().eq("id", cf.dataset.delComp));
    if (!error) { currentId = null; view = "overall"; rememberUi(); }
  }
  if (error) showBanner(errText(error));
  await refresh();
});

document.addEventListener("input", e => {
  if (e.target.id === "peopleSearch") {
    msgs.peopleFilter = { text: e.target.value };
    const pos = e.target.selectionStart; render(); const el = $("peopleSearch"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
});

document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "compSelect") {
    if (t.value === "__new") return newComp();
    currentId = t.value; view = "overall"; rememberUi(); return refresh();
  }
  if (t.id === "spFormat" || t.id === "spDraws") return applySportFormat();
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
    const { error } = await sb.auth.signInWithPassword({ email: $("aEmail").value.trim(), password: $("aPass").value });
    if (error) setMsg("authMsg", error.message === "Invalid login credentials" ? "That email and password don't match an account." : error.message);
    return;
  }
  if (f.id === "signupForm") {
    const full_name = $("aName").value.trim(), college = $("aCollege").value.trim(), email = $("aEmail").value.trim(), password = $("aPass").value;
    if (!full_name) return setMsg("authMsg", "Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg("authMsg", "Enter a valid email address.");
    if (password.length < 8) return setMsg("authMsg", "Use a password with at least 8 characters.");
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, college }, emailRedirectTo: location.origin + location.pathname } });
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
    const { error } = await sb.from("competitions").update({ name, kind: $("cKind").value, medal_points: medal }).eq("id", c.id);
    if (error) return setMsg("compMsg", errText(error));
    setMsg("compMsg", "Saved.", true); await refresh();
  }
});

/* ---------- start ---------- */
let channel = null;
async function start() {
  if (!session) { if (channel) { sb.removeChannel(channel); channel = null; } shellReady = false; return authScreen(); }
  await loadProfile();
  await loadAll();
  render();
  if (!channel) channel = sb.channel("live").on("postgres_changes", { event: "*", schema: "public" }, scheduleReload).subscribe();
}

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
