// Builds the printable results report (PDF) in the browser with jsPDF + AutoTable.
// app.js gathers the data; this file only lays it out in the event's logo and palette.

const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const AUTOTABLE_URL = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement("script"), { src, async: true });
    s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load the PDF tools. Check your connection and try again."));
    document.head.append(s);
  });
}
async function loadPdfTools() {
  if (!window.jspdf) await loadScript(JSPDF_URL);
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript(AUTOTABLE_URL);
  return window.jspdf.jsPDF;
}

/* ---------- small helpers ---------- */
const rgb = hex => { const h = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#1d6a43"; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const WHITE = [255, 255, 255], INK = [17, 24, 39], MUTED = [107, 114, 128], LINE = [229, 231, 235];
const MEDAL = [[201, 151, 28], [141, 150, 156], [168, 100, 58]];
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const onColor = c => lum(c) > .45 ? INK : WHITE;
// The built-in PDF fonts cover Latin-1; swap the few common characters outside it.
const clean = s => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");
const num = n => Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const fmtDate = d => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtStamp = d => new Date(d).toLocaleString(undefined, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// Loads any image URL (PNG, JPG, WebP, SVG) into a PNG data URL the PDF can embed.
function imageData(url, max = 320) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image(); img.crossOrigin = "anonymous";
    const done = v => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => done(null), 6000);
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || 300, h0 = img.naturalHeight || 300, k = Math.min(1, max / Math.max(w0, h0));
        const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        done({ data: cv.toDataURL("image/png"), ratio: cv.width / cv.height });
      } catch (e) { done(null); }
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}
// Fits an image inside a box, keeping its shape, centred.
function drawFit(doc, im, x, y, w, h) {
  if (!im) return;
  let dw = w, dh = w / im.ratio; if (dh > h) { dh = h; dw = h * im.ratio; }
  doc.addImage(im.data, "PNG", x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/* ---------- the report ---------- */
// Layout: a white letterhead with the event logo, numbered sections (summary with contents, overall standings,
// results by sport, certification), plain ruled tables, and the event color only for rules, headings and accents.
export async function buildReport(data, opts) {
  const jsPDF = await loadPdfTools();
  const doc = new jsPDF({ unit: "mm", format: opts.paper || "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  const P1 = rgb(data.comp.accent), P2 = data.comp.accent2 ? rgb(data.comp.accent2) : mix(P1, [0, 0, 0], .5);
  const HEAD = mix(P1, WHITE, .9), SOFT = [248, 249, 250], RULE = [229, 231, 235];
  const ACC = lum(P1) > .5 ? P2 : P1; // the event color, darkened when too light to read on white
  doc.setProperties({ title: clean(`${data.comp.name} - Official results`), subject: "Results", creator: "Sports Leaderboard", author: clean(data.by) });

  // logos: event + teams
  const eventLogo = await imageData(data.comp.logo, 400);
  const teamLogos = new Map();
  await Promise.all(data.teams.filter(t => t.logo).map(async t => teamLogos.set(t.id, await imageData(t.logo, 120))));
  const teamColor = new Map(data.teams.map(t => [t.id, rgb(t.color)]));

  const font = (style, size, color = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };

  /* page furniture */
  const letterhead = () => {
    const top = 14, size = 22;
    let tx = M;
    if (eventLogo) { drawFit(doc, eventLogo, M, top, size, size); tx = M + size + 6; }
    font("bold", 8, ACC);
    doc.text(clean(`${(data.comp.kind || "Competition").toUpperCase()}   |   OFFICIAL RESULTS`), tx, top + 4, { charSpace: .3 });
    font("bold", 18);
    const title = doc.splitTextToSize(clean(data.comp.name), W - tx - M).slice(0, 2);
    doc.text(title, tx, top + 11.5);
    const after = top + 11.5 + (title.length - 1) * 7;
    font("normal", 9, MUTED);
    doc.text(clean(`As of ${fmtStamp(data.generated)}`), tx, after + 6);
    const bottom = Math.max(top + size, after + 7) + 5;
    doc.setFillColor(...ACC); doc.rect(M, bottom, W - 2 * M, .7, "F");
    return bottom + 10;
  };
  const runningHead = () => {
    let tx = M;
    if (eventLogo) { drawFit(doc, eventLogo, M, 7, 7, 7); tx = M + 9.5; }
    font("bold", 9); doc.text(clean(data.comp.name), tx, 11.8, { maxWidth: W - tx - M - 32 });
    font("normal", 8, MUTED); doc.text("Official results", W - M, 11.8, { align: "right" });
    doc.setDrawColor(...RULE); doc.setLineWidth(.3); doc.line(M, 16, W - M, 16);
  };
  const TOP = 24, BOTTOM = H - 18;
  let y = letterhead();
  const newPage = () => { doc.addPage(); runningHead(); y = TOP; };
  const ensure = need => { if (y + need > BOTTOM) newPage(); };

  // numbered headings; their page numbers feed the contents list
  const toc = [];
  let secNo = 0, subNo = 0;
  const section = (title, sub) => {
    ensure(24);
    secNo++; subNo = 0;
    toc.push({ label: `${secNo}  ${title}`, page: doc.getNumberOfPages(), level: 0 });
    font("bold", 13, ACC); doc.text(String(secNo), M, y);
    font("bold", 13); doc.text(clean(title), M + 7, y);
    if (sub) { font("normal", 8.5, MUTED); doc.text(clean(sub), W - M, y, { align: "right", maxWidth: 95 }); }
    doc.setDrawColor(...RULE); doc.setLineWidth(.3); doc.line(M, y + 3, W - M, y + 3);
    y += 10;
  };
  const subsection = (title, sub, need = 30) => {
    ensure(need);
    subNo++;
    toc.push({ label: `${secNo}.${subNo}  ${title}`, page: doc.getNumberOfPages(), level: 1 });
    font("bold", 11, ACC); doc.text(`${secNo}.${subNo}`, M, y);
    font("bold", 11); doc.text(clean(title), M + 10, y);
    if (sub) { font("normal", 8.5, MUTED); doc.text(clean(sub), W - M, y, { align: "right", maxWidth: 110 }); }
    y += 4.5;
  };

  const tableBase = extra => ({
    startY: y, margin: { left: M, right: M, top: TOP, bottom: H - BOTTOM },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: { top: 2.3, bottom: 2.3, left: 2.2, right: 2.2 }, valign: "middle", halign: "center", lineColor: RULE, lineWidth: { bottom: .2 } },
    headStyles: { fillColor: HEAD, textColor: mix(ACC, INK, .35), fontStyle: "bold", fontSize: 7.8, lineColor: ACC, lineWidth: { bottom: .5 } },
    didDrawPage: d => { if (d.pageNumber > 1) runningHead(); }, // pages a long table spills onto
    ...extra,
  });
  const afterTable = (gap = 10) => { y = doc.lastAutoTable.finalY + gap; };
  // colour dot or logo in front of a team name (the name cell has room on its left)
  const teamMark = (d, teamId) => {
    if (d.section !== "body" || !teamId) return;
    const x = d.cell.x + 2.2, cy = d.cell.y + d.cell.height / 2, im = teamLogos.get(teamId);
    if (im) drawFit(doc, im, x - .3, cy - 2.4, 4.8, 4.8);
    else { doc.setFillColor(...(teamColor.get(teamId) || MUTED)); doc.circle(x + 2.1, cy, 1.4, "F"); }
  };
  // 1st, 2nd and 3rd as gold, silver and bronze discs in the rank column
  const rankDisc = (d, pos, ok) => {
    if (d.section !== "body" || d.column.index !== 0) return;
    const cx = d.cell.x + d.cell.width / 2, cy = d.cell.y + d.cell.height / 2;
    if (ok && pos <= 3) { doc.setFillColor(...MEDAL[pos - 1]); doc.circle(cx, cy, 2.5, "F"); font("bold", 8, WHITE); }
    else font("bold", 8.5, MUTED);
    doc.text(String(pos), cx, cy + 1, { align: "center" });
  };
  const nameCol = { halign: "left", cellPadding: { left: 9, top: 2.3, bottom: 2.3, right: 2 }, fontStyle: "bold" };
  const hideRank = d => { if (d.section === "body" && d.column.index === 0) d.cell.text = [""]; };

  const played = data.sports.filter(s => s.matches.length || s.events.length);
  const waiting = data.sports.filter(s => !s.matches.length && !s.events.length);

  /* 1 summary + contents, 2 overall standings */
  let tocAt = null;
  if (opts.overall) {
    section("Summary");
    const s = data.stats, top = data.overall.find(r => r.pts > 0);
    const figs = [[s.teams, data.unitT === "College" ? "Colleges" : "Teams"], [`${s.done} of ${s.sports}`, "Sports with results"], [s.matches, "Matches played"], [s.events, "Events finished"]];
    const bw = (W - 2 * M) / 4, bh = 17;
    doc.setDrawColor(...RULE); doc.setLineWidth(.3); doc.roundedRect(M, y, W - 2 * M, bh, 1.5, 1.5, "S");
    figs.forEach(([v, l], i) => {
      const x = M + i * bw;
      if (i) doc.line(x, y + 3, x, y + bh - 3);
      font("bold", 15); doc.text(String(v), x + bw / 2, y + 8, { align: "center" });
      font("normal", 7.8, MUTED); doc.text(l, x + bw / 2, y + 13, { align: "center" });
    });
    y += bh + 7;
    if (top) {
      font("normal", 9.5, MUTED); doc.text("Leading overall:", M, y);
      const lx = M + doc.getTextWidth("Leading overall: ");
      font("bold", 9.5); doc.text(clean(top.name), lx, y);
      const nx = lx + doc.getTextWidth(clean(top.name));
      font("normal", 9.5, MUTED); doc.text(clean(`  ·  ${num(top.pts)} pts  (${top.g} gold, ${top.sv} silver, ${top.b} bronze)`), nx, y);
      y += 8;
    }
    // space for the contents, filled in once every page is laid out
    const entries = 2 + ((opts.standings || opts.results) && data.sports.length ? 1 + played.length : 0) + (opts.signatures ? 1 : 0);
    if (entries > 2) {
      font("bold", 9.5); doc.text("Contents", M, y); y += 5;
      tocAt = { page: doc.getNumberOfPages(), y, rows: Math.ceil(entries / 2) };
      y += tocAt.rows * 5.2 + 6;
    }

    section("Overall standings", `Top 3 of each sport earn gold, silver, bronze  |  ${data.comp.medalPts.map((p, i) => `${ordinal(i + 1)} ${num(p)}`).join(", ")} pts`);
    const rows = data.overall;
    doc.autoTable(tableBase({
      head: [["#", data.unitT, "Gold", "Silver", "Bronze", "Sports", "Points"]],
      body: rows.map(r => [r.pos, clean(r.name), r.g, r.sv, r.b, r.sports, num(r.pts)]),
      columnStyles: { 0: { cellWidth: 12 }, 1: nameCol, 6: { fontStyle: "bold", fontSize: 10 } },
      didParseCell: d => { hideRank(d); if (d.section === "body" && [2, 3, 4].includes(d.column.index) && !Number(d.cell.raw)) d.cell.styles.textColor = [175, 180, 186]; },
      didDrawCell: d => { const r = rows[d.row.index]; if (!r) return; rankDisc(d, r.pos, r.pts > 0); if (d.column.index === 1) teamMark(d, r.id); },
    }));
    afterTable(12);
  }

  /* results by sport */
  if ((opts.standings || opts.results) && data.sports.length) {
    if (opts.newPage && y > TOP) newPage();
    const first = played[0]; // keep the section title with the first sport's table
    ensure(first ? 26 + Math.min(opts.standings ? first.rows.filter(r => r.active).length : first.matches.length + first.events.length, 12) * 7.8 : 24);
    section("Results by sport", `${data.sports.length} sport${data.sports.length === 1 ? "" : "s"}`);
    played.forEach((s, i) => {
      if (opts.newPage && i > 0) newPage();
      const n = s.format === "placing" ? s.events.length : s.matches.length;
      const count = s.format === "placing" ? `${n} event${n === 1 ? "" : "s"}` : `${n} match${n === 1 ? "" : "es"}`;
      const rows = s.rows.filter(r => r.active).map((r, k) => ({ ...r, pos: k + 1 }));
      subsection(s.name, `${s.format === "placing" ? "Placings" : "Head-to-head"}  |  ${s.scoring}  |  ${count}`, 16 + Math.min(opts.standings ? rows.length : n, 12) * 7.8);
      if (opts.standings) {
        const head = s.format === "placing" ? ["#", "Team", "Events", "1st", "2nd", "3rd", "Points"]
          : ["#", "Team", "P", "W", ...(s.draws ? ["D"] : []), "L", "For", "Against", "+/-", "Points"];
        const body = rows.map(r => s.format === "placing" ? [r.pos, clean(r.name), r.e, r.g, r.sv, r.b, num(r.pts)]
          : [r.pos, clean(r.name), r.p, r.w, ...(s.draws ? [r.d] : []), r.l, num(r.f), num(r.a), (r.diff > 0 ? "+" : "") + num(r.diff), num(r.pts)]);
        const last = head.length - 1;
        doc.autoTable(tableBase({
          head: [head], body,
          columnStyles: { 0: { cellWidth: 12 }, 1: nameCol, [last]: { fontStyle: "bold", fontSize: 10 } },
          didParseCell: hideRank,
          didDrawCell: d => { const r = rows[d.row.index]; if (!r) return; rankDisc(d, r.pos, true); if (d.column.index === 1) teamMark(d, r.id); },
        }));
        afterTable(opts.results ? 4 : 11);
      }
      if (opts.results) {
        ensure(26); // keep the results header with its first rows
        const sub = { headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: "bold", fontSize: 7.5, lineColor: RULE, lineWidth: { bottom: .3 } } };
        if (s.format === "placing") {
          doc.autoTable(tableBase({ ...sub,
            head: [["Date", "Event", "1st", "2nd", "3rd"]],
            body: s.events.map(e => [fmtDate(e.at), clean(e.name), clean(e.order[0] || "-"), clean(e.order[1] || "-"), clean(e.order[2] || "-")]),
            columnStyles: { 0: { cellWidth: 25, halign: "left", textColor: MUTED, fontSize: 8.3 }, 1: { halign: "left", fontStyle: "bold" }, 2: { fontStyle: "bold" } },
          }));
        } else {
          const ms = s.matches;
          doc.autoTable(tableBase({ ...sub,
            head: [["Date", "Home", "Score", "Away", "Winner"]],
            body: ms.map(m => [fmtDate(m.at), clean(m.h), `${num(m.hs)} - ${num(m.as)}`, clean(m.a), m.hs === m.as ? "Draw" : clean(m.hs > m.as ? m.h : m.a)]),
            columnStyles: { 0: { cellWidth: 25, halign: "left", textColor: MUTED, fontSize: 8.3 }, 1: { halign: "right" }, 2: { cellWidth: 19, fontStyle: "bold", fontSize: 9.5 }, 3: { halign: "left" }, 4: { halign: "left", textColor: MUTED, fontSize: 8.3 } },
            didParseCell: d => { if (d.section !== "body") return; const m = ms[d.row.index]; if ((d.column.index === 1 && m.hs > m.as) || (d.column.index === 3 && m.as > m.hs)) d.cell.styles.fontStyle = "bold"; },
          }));
        }
        afterTable(11);
      }
    });
    if (waiting.length) {
      ensure(16);
      const text = doc.splitTextToSize(clean(`No results yet: ${waiting.map(s => s.name).join(", ")}.`), W - 2 * M);
      font("normal", 9, MUTED); doc.text(text, M, y + 1); y += text.length * 4.5 + 8;
    }
  }

  /* certification */
  if (opts.signatures) {
    y += 4; ensure(56);
    section("Certification");
    font("normal", 9, MUTED);
    doc.text("We certify that the results above are true and correct as of the date shown.", M, y); y += 22;
    const sw = (W - 2 * M - 2 * 10) / 3;
    [["Prepared by", data.by, data.byRole], ["Checked by", "", "Sports Coordinator"], ["Approved by", "", "Tournament Director"]].forEach(([cap, name, role], i) => {
      const x = M + i * (sw + 10);
      font("bold", 7.5, ACC); doc.text(cap.toUpperCase(), x, y - 12, { charSpace: .2 });
      if (name) { font("normal", 10); doc.text(clean(name), x, y - 2, { maxWidth: sw }); }
      doc.setDrawColor(...INK); doc.setLineWidth(.3); doc.line(x, y, x + sw, y);
      font("normal", 8, MUTED); doc.text(clean(role), x, y + 4.5);
      doc.text("Date: ____________", x, y + 10);
    });
    y += 14;
  }

  /* contents list, now that page numbers are known */
  if (tocAt) {
    doc.setPage(tocAt.page);
    const colW = (W - 2 * M - 10) / 2;
    toc.forEach((e, i) => {
      const col = Math.floor(i / tocAt.rows), row = i % tocAt.rows;
      const x = M + col * (colW + 10), ty = tocAt.y + row * 5.2;
      font(e.level ? "normal" : "bold", 8.8, e.level ? INK : INK);
      const label = clean(e.level ? `    ${e.label}` : e.label);
      doc.text(label, x, ty, { maxWidth: colW - 14 });
      const lw = Math.min(doc.getTextWidth(label), colW - 14);
      font("normal", 8.8, MUTED);
      doc.setDrawColor(...RULE); doc.setLineDashPattern([.4, .9], 0); doc.line(x + lw + 2, ty - .6, x + colW - 8, ty - .6); doc.setLineDashPattern([], 0);
      doc.text(String(e.page), x + colW, ty, { align: "right" });
    });
  }

  /* footer on every page */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE); doc.setLineWidth(.3); doc.line(M, H - 12, W - M, H - 12);
    font("normal", 7.5, MUTED);
    doc.text(clean(`Generated by ${data.by} (${data.byRole}) on ${fmtStamp(data.generated)}`), M, H - 7.5);
    doc.text(`Page ${i} of ${n}`, W - M, H - 7.5, { align: "right" });
  }
  return doc;
}

export const reportFileName = (name, d = new Date()) =>
  `${String(name).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "results"}-results-${d.toISOString().slice(0, 10)}.pdf`;
