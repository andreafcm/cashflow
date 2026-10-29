/* Monatsabschluss: Lohnliste je Firma und Monat (Farben aus dem Änderungsprotokoll),
   Monatswerte, Excel im bisherigen Layout, E-Mail-Entwurf an TLC, Unterlagen-ZIP.
   Farben wie HR sie heute nutzt: Änderung = hellgrün, Stundenlöhner = orange, Folgemonat = blau. */
"use strict";
const LL = {
  GREEN: "FFC6E0B4", ORANGE: "FFFFC000", BLUE: "FFB4C6E7", LEGEND: "FFA9D08E",
  COLS: [
    ["pers_nr", "Pers.Nr.", 10.9], ["name", "Name", 32.7], ["entry_date", "Eintritt", 10.9], ["exit_date", "Austritt", 12.4],
    ["weekly_hours", "wöchentl. Arbeitszeit", 14.4], ["pay", "Gehalt in EUR", 12], ["hours", "Stunden", 12.4], ["overtime", "Über std.", 10.9],
    ["commission", "Provision", 13], ["other_label", "Bezeichnung sonstige Bezüge", 39.6], ["other_amount", "Betrag sonstige Bezüge", 17.6],
    ["bvg", "BVG (St./Sv-frei)", 16.4], ["comment", "Kommentar", 76.3],
  ],
  // Stammdaten-Feld -> Spalte der Lohnliste (alles andere landet als Text im Kommentar)
  FIELD_COL: { pers_nr: "pers_nr", last_name: "name", first_name: "name", entry_date: "entry_date", exit_date: "exit_date",
    weekly_hours: "weekly_hours", salary_monthly: "pay", hourly_wage: "pay", pay_type: "pay" },
  RELEVANT: ["pers_nr", "last_name", "first_name", "entry_date", "exit_date", "weekly_hours", "monthly_hours", "salary_monthly", "hourly_wage",
    "pay_type", "fixed_term_until", "employment_type", "vacation_days", "tax_class", "child_allowances", "marital_status", "health_insurance",
    "tax_id", "sv_number", "iban", "religion"],
  NUM: ["weekly_hours", "monthly_hours", "salary_monthly", "hourly_wage", "vacation_days", "child_allowances"],
  INPUTS: ["hours", "overtime", "commission", "other_label", "other_amount", "bvg", "comment"],
  MONATE: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};
const ym = (d) => d.slice(0, 7);
const firstOf = (y, m) => `${y}-${String(m).padStart(2, "0")}-01`;
function monthBounds(key) {           // key = "2026-10"
  const [y, m] = key.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const nextEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { start: firstOf(y, m), end, nextEnd, prev, label: `${LL.MONATE[m - 1]} ${y}`, sheet: `${String(m).padStart(2, "0")}${String(y).slice(2)}` };
}
const de = (iso) => iso ? iso.slice(0, 10).split("-").reverse().join(".") : "";
const eur = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
function showVal(field, v) {
  if (v == null || v === "") return "–";
  if (["salary_monthly", "hourly_wage"].includes(field)) return eur(v);
  if (LL.NUM.includes(field)) return Number(v).toLocaleString("de-DE");
  if (/date|_until/.test(field)) return de(v);
  return String(v);
}

/* ---------- Kernlogik: eine Monatsliste aus Stammdaten + Protokoll + Monatswerten ---------- */
function buildMonth(key, emps, logs, inputs) {
  const B = monthBounds(key);
  const inp = Object.fromEntries(inputs.filter((i) => ym(i.month) === key).map((i) => [i.employee_id, i]));
  const prevInp = Object.fromEntries(inputs.filter((i) => ym(i.month) === B.prev).map((i) => [i.employee_id, i]));
  const rows = [];
  for (const e of emps) {
    const L = logs.filter((l) => l.employee_id === e.id).sort((a, b) => b.changed_at.localeCompare(a.changed_at));
    // Stand zum Monatsende: Änderungen, die erst später gelten, zurückdrehen (außer Ein-/Austritt, die gelten ab Bekanntwerden)
    const v = { ...e };
    for (const l of L) if (l.field !== "*" && !["entry_date", "exit_date"].includes(l.field) && l.effective_from && l.effective_from > B.end)
      v[l.field] = l.old_value == null ? null : LL.NUM.includes(l.field) ? Number(l.old_value) : l.old_value;
    if (!v.entry_date || v.entry_date > B.end || (v.exit_date && v.exit_date < B.start)) continue;
    const marks = {}, notes = [], next = [];
    const isNew = v.entry_date >= B.start && v.entry_date <= B.end;
    if (isNew) notes.push(`Neueintritt zum ${de(v.entry_date)}`);
    if (v.exit_date && v.exit_date >= B.start && v.exit_date <= B.end) { marks.exit_date = LL.GREEN; notes.push(`Austritt zum ${de(v.exit_date)}`); }
    for (const l of [...L].reverse()) {
      if (l.field === "*" || !LL.RELEVANT.includes(l.field)) continue;
      const recorded = l.changed_at.slice(0, 10);
      const eff = ["entry_date", "exit_date"].includes(l.field) ? recorded : (l.effective_from || recorded);
      const col = LL.FIELD_COL[l.field] || "comment";
      const txt = `${FIELD_LABEL[l.field] || l.field}: ${showVal(l.field, l.old_value)} → ${showVal(l.field, l.new_value)}`;
      if (isNew && ["entry_date", "last_name", "first_name"].includes(l.field)) continue;
      if (eff >= B.start && eff <= B.end) {
        marks[col] = LL.GREEN;
        if (l.field === "exit_date" && l.new_value) { if (!notes.some((n) => n.startsWith("Austritt"))) notes.push(`Austritt zum ${de(l.new_value)}`); }
        else notes.push(txt + (l.effective_from && l.effective_from !== B.start ? ` ab ${de(l.effective_from)}` : ""));
      } else if (eff > B.end && eff <= B.nextEnd) {
        if (!marks[col]) marks[col] = LL.BLUE;
        next.push(`ab ${de(eff)}: ${txt}`);
      }
    }
    const i = inp[e.id] || {}, p = prevInp[e.id] || {};
    const hourly = v.pay_type === "stundenlohn";
    if (hourly) { marks.pers_nr ||= LL.ORANGE; marks.hours ||= LL.ORANGE; }
    for (const k of ["overtime", "commission", "other_label", "other_amount", "bvg"])
      if (i[k] != null && i[k] !== "" && String(i[k]) !== String(p[k] ?? "")) marks[k] = LL.GREEN;
    if (!hourly && i.hours != null && i.hours !== "" && String(i.hours) !== String(p.hours ?? "")) marks.hours = LL.GREEN;
    const autoComment = [...notes, ...next].join("; ");
    if (notes.length && !marks.comment) marks.comment = LL.GREEN;
    rows.push({
      e, v, isNew, hourly, marks, notes, next, input: i,
      cells: {
        pers_nr: v.pers_nr ?? "", name: `${v.last_name}, ${v.first_name}`, entry_date: de(v.entry_date), exit_date: de(v.exit_date),
        weekly_hours: v.weekly_hours ?? "", pay: hourly ? null : v.salary_monthly, wage: v.hourly_wage, hours: i.hours ?? "",
        overtime: i.overtime ?? "", commission: i.commission ?? "", other_label: i.other_label ?? "", other_amount: i.other_amount ?? "",
        bvg: i.bvg ?? "", comment: [autoComment, i.comment].filter(Boolean).join(" | "),
      },
      docs: L.filter((l) => l.source_document_id && (() => { const eff = l.effective_from || l.changed_at.slice(0, 10); return (eff >= B.start && eff <= B.end) || (l.field === "*" && isNew); })()).map((l) => l.source_document_id),
    });
  }
  const pn = (r) => { const n = parseInt(r.cells.pers_nr, 10); return Number.isNaN(n) ? 1e12 : n; };
  rows.sort((a, b) => pn(a) - pn(b) || a.cells.name.localeCompare(b.cells.name, "de"));
  return { B, rows };
}

/* ---------- Daten laden ---------- */
async function loadCompanyYear(cid, key) {
  const y = key.slice(0, 4);
  const B = monthBounds(key);
  const [{ data: emps }, { data: logs }, { data: inputs }, { data: close }] = await Promise.all([
    sb.from("employees").select("*").eq("company_id", cid),
    sb.from("change_log").select("employee_id,field,old_value,new_value,effective_from,changed_at,source,source_document_id").eq("company_id", cid),
    sb.from("payroll_inputs").select("*").eq("company_id", cid).gte("month", `${Number(y) - 1}-12-01`).lte("month", B.start),
    sb.from("payroll_closes").select("*").eq("company_id", cid).eq("month", B.start).maybeSingle(),
  ]);
  return { emps: emps || [], logs: logs || [], inputs: inputs || [], close };
}

/* ---------- Ansicht ---------- */
async function viewMonat() {
  const m = $("#main");
  const now = new Date();
  S.monat ||= { company: S.companies[0]?.id, key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` };
  m.innerHTML = `<div class="head"><div><h1>Monatsabschluss</h1>
      <p>Lohnliste für TLC. Farben kommen automatisch aus dem Änderungsprotokoll: <span class="lg" style="background:#C6E0B4">Änderung</span>
      <span class="lg" style="background:#B4C6E7">für Folgemonat</span> <span class="lg" style="background:#FFC000">Stundenlöhner</span>. Monatswerte direkt in der Tabelle eintragen.</p></div>
      <label class="f" style="width:170px">Monat<input type="month" id="mo-key" value="${S.monat.key}"></label></div>
    <div class="tabs" role="group" aria-label="Firma">${S.companies.map((c) => `<button class="tab" data-c="${c.id}" aria-pressed="${c.id === S.monat.company}">${esc(c.name)}</button>`).join("")}</div>
    <div class="bar" id="mo-bar"></div>
    <div class="panel scroll" id="mo-table"><div class="empty">Lädt …</div></div>
    <div class="panel" id="mo-mail" hidden></div>`;
  $$(".tab").forEach((t) => t.onclick = () => { S.monat.company = t.dataset.c; viewMonat(); });
  $("#mo-key").onchange = (e) => { if (e.target.value) { S.monat.key = e.target.value; viewMonat(); } };
  await refreshMonat();
}

async function refreshMonat() {
  const { company, key } = S.monat;
  const D = await loadCompanyYear(company, key);
  S.monat.data = D;
  const { B, rows } = buildMonth(key, D.emps, D.logs, D.inputs);
  S.monat.rows = rows;
  const cname = S.companies.find((c) => c.id === company)?.name || "";
  const st = D.close?.status || "entwurf";
  const steps = [["entwurf", "Entwurf"], ["an_tlc", "An TLC gesendet"], ["tlc_ok", "TLC OK"], ["unterlagen", "Unterlagen gesendet"]];
  const idx = steps.findIndex((s) => s[0] === st);
  const changes = rows.filter((r) => r.notes.length || r.next.length || Object.values(r.marks).includes(LL.GREEN)).length;
  $("#mo-bar").innerHTML = `
    <div class="grow"><b>${esc(cname)} · ${esc(B.label)}</b><div class="hint">${rows.length} Mitarbeiter · ${changes} mit Änderungen</div></div>
    <div class="steps">${steps.map((s, n) => `<span class="pill ${n < idx ? "ok" : n === idx ? "ink" : ""}">${n < idx ? "✓ " : ""}${esc(s[1])}</span>`).join("")}</div>
    <button class="btn" id="mo-xlsx" ${rows.length ? "" : "disabled"}>Excel herunterladen</button>
    <button class="btn" id="mo-docs">Unterlagen (ZIP)</button>
    <button class="btn primary" id="mo-mailbtn" ${rows.length ? "" : "disabled"}>E-Mail-Entwurf</button>
    ${canEdit() && idx < 3 ? `<button class="btn" id="mo-next">Weiter: ${esc(steps[idx + 1][1])}</button>` : ""}`;
  $("#mo-xlsx").onclick = () => exportYear(cname, key, D);
  $("#mo-mailbtn").onclick = () => showMail(cname, B, rows);
  $("#mo-docs").onclick = () => zipMonthDocs(cname, B, rows);
  if ($("#mo-next")) $("#mo-next").onclick = async () => {
    const ns = steps[idx + 1][0], stamp = { an_tlc: "sent_at", tlc_ok: "ok_at", unterlagen: "docs_at" }[ns];
    const { error } = await sb.from("payroll_closes").upsert({ company_id: company, month: B.start, status: ns, [stamp]: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error) return toast("Status: " + error.message);
    refreshMonat();
  };
  renderMonthTable(rows);
}

function cellHtml(r, k) {
  const c = r.cells, edit = canEdit() && LL.INPUTS.includes(k);
  const bg = r.isNew ? LL.GREEN : r.marks[k];
  const style = bg ? ` style="background:#${bg.slice(2)};color:#18212c"` : "";
  if (edit) {
    const val = k === "comment" ? (r.input.comment ?? "") : c[k];
    const auto = k === "comment" && [...r.notes, ...r.next].join("; ");
    return `<td${style}>${auto ? `<div class="hint" style="color:inherit;opacity:.8">${esc(auto)}</div>` : ""}<input class="mi${k === "comment" || k === "other_label" ? " wide" : ""}" data-e="${r.e.id}" data-k="${k}" ${["other_label", "comment"].includes(k) ? "" : 'inputmode="decimal"'} value="${esc(val)}" placeholder="${k === "comment" ? "Kommentar" : "–"}"></td>`;
  }
  let t = c[k];
  if (k === "pay") t = r.hourly ? (c.hours ? `${eur(Number(c.hours) * Number(c.wage || 0))} <span class="hint">(${esc(c.hours)} h × ${eur(c.wage)})</span>` : `<span class="hint">${eur(c.wage)}/h</span>`) : eur(c.pay);
  else if (["commission", "other_amount", "bvg"].includes(k)) t = eur(t);
  else t = esc(t);
  return `<td${style}${["pay", "commission", "other_amount", "bvg", "weekly_hours", "hours", "overtime"].includes(k) ? ' class="mono"' : ""}>${t}</td>`;
}

function renderMonthTable(rows) {
  const el = $("#mo-table");
  if (!rows.length) { el.innerHTML = `<div class="empty">Keine aktiven Mitarbeiter in diesem Monat. Mitarbeiter entstehen beim Bestätigen eines Arbeitsvertrags (Eintrittsdatum nötig).</div>`; return; }
  el.innerHTML = `<table class="tbl ll"><thead><tr>${LL.COLS.map(([, h]) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${LL.COLS.map(([k]) => cellHtml(r, k)).join("")}</tr>`).join("")}</tbody></table>`;
  $$(".mi", el).forEach((inp) => inp.onchange = () => saveInput(inp));
}

async function saveInput(inp) {
  const { company, key } = S.monat, k = inp.dataset.k;
  let v = inp.value.trim();
  if (v === "") v = null;
  else if (!["other_label", "comment"].includes(k)) {
    const n = v.includes(",") ? Number(v.replace(/\./g, "").replace(",", ".")) : Number(v);
    if (Number.isNaN(n)) { inp.style.outline = "2px solid var(--bad)"; return toast("Bitte eine Zahl eintragen"); }
    v = n;
  }
  const { error } = await sb.from("payroll_inputs").upsert({ company_id: company, employee_id: inp.dataset.e, month: monthBounds(key).start, [k]: v,
    updated_at: new Date().toISOString() }, { onConflict: "employee_id,month" });
  if (error) return toast("Speichern fehlgeschlagen: " + error.message);
  toast("Gespeichert");
  await refreshMonat();
}

/* ---------- E-Mail an TLC ---------- */
function mailText(cname, B, rows) {
  const name = (r) => r.cells.name;
  const neu = rows.filter((r) => r.isNew), aus = rows.filter((r) => r.v.exit_date && r.v.exit_date >= B.start && r.v.exit_date <= B.end);
  const chg = rows.filter((r) => !r.isNew && r.notes.filter((n) => !n.startsWith("Austritt")).length);
  const werte = rows.filter((r) => ["overtime", "commission", "other_amount", "bvg"].some((k) => r.input[k] != null && r.input[k] !== ""));
  const std = rows.filter((r) => r.hourly);
  const folge = rows.filter((r) => r.next.length);
  const L = [];
  L.push("Hallo zusammen,", "", `anbei die Lohnliste der ${cname} für ${B.label}. Änderungen sind grün markiert, Stundenlöhner orange${folge.length ? ", Änderungen für den Folgemonat blau" : ""}.`, "");
  if (neu.length) { L.push("Neueintritte:"); neu.forEach((r) => L.push(`- ${name(r)}: Eintritt ${r.cells.entry_date}${r.v.position ? `, ${r.v.position}` : ""}${r.v.weekly_hours ? `, ${Number(r.v.weekly_hours).toLocaleString("de-DE")} Std./Woche` : ""}, ${r.hourly ? `Stundenlohn ${eur(r.v.hourly_wage)}` : `Gehalt ${eur(r.v.salary_monthly)}`}`)); L.push(""); }
  if (aus.length) { L.push("Austritte:"); aus.forEach((r) => L.push(`- ${name(r)} zum ${r.cells.exit_date}`)); L.push(""); }
  if (chg.length) { L.push("Änderungen:"); chg.forEach((r) => L.push(`- ${name(r)}: ${r.notes.filter((n) => !n.startsWith("Austritt") && !n.startsWith("Neueintritt")).join("; ")}`)); L.push(""); }
  if (werte.length) {
    L.push("Monatswerte:");
    werte.forEach((r) => { const i = r.input, p = [];
      if (i.overtime) p.push(`${Number(i.overtime).toLocaleString("de-DE")} Überstunden`); if (i.commission) p.push(`Provision ${eur(i.commission)}`);
      if (i.other_amount) p.push(`${i.other_label || "sonstige Bezüge"} ${eur(i.other_amount)}`); if (i.bvg) p.push(`BVG ${eur(i.bvg)}`);
      L.push(`- ${name(r)}: ${p.join(", ")}`); });
    L.push("");
  }
  if (std.length) { L.push("Stunden der Stundenlöhner:"); std.forEach((r) => L.push(`- ${name(r)}: ${r.cells.hours !== "" ? `${Number(r.cells.hours).toLocaleString("de-DE")} Std.` : "(noch offen)"}`)); L.push(""); }
  if (folge.length) { L.push("Vorab für den Folgemonat:"); folge.forEach((r) => L.push(`- ${name(r)}: ${r.next.join("; ")}`)); L.push(""); }
  if (!neu.length && !aus.length && !chg.length && !werte.length && !folge.length) L.push("In diesem Monat gibt es keine Änderungen.", "");
  L.push("Bitte gebt kurz Bescheid, ob alles passt. Die zugehörigen Unterlagen schicken wir euch im Anschluss.", "", "Viele Grüße");
  return { subject: `Lohnliste ${cname} – ${B.label}`, body: L.join("\n") };
}
function showMail(cname, B, rows) {
  const { subject, body } = mailText(cname, B, rows), el = $("#mo-mail");
  el.hidden = false;
  el.innerHTML = `<div class="sec"><div class="head"><h2>E-Mail-Entwurf an TLC</h2>
      <div class="acts"><button class="btn small" id="mm-copy">Text kopieren</button><a class="btn small" id="mm-open" href="mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">Im Mailprogramm öffnen</a></div></div>
    <label class="f">Betreff<input id="mm-subj" value="${esc(subject)}"></label>
    <label class="f">Text<textarea id="mm-body" rows="${Math.min(30, body.split("\n").length + 2)}">${esc(body)}</textarea></label>
    <p class="hint" style="margin:0">Excel-Datei mit „Excel herunterladen“ speichern und an die E-Mail anhängen. Text vor dem Senden prüfen.</p></div>`;
  $("#mm-copy").onclick = async () => { try { await navigator.clipboard.writeText(`${$("#mm-subj").value}\n\n${$("#mm-body").value}`); toast("Kopiert"); } catch (_) { $("#mm-body").select(); toast("Text markiert – mit Strg+C kopieren"); } };
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Unterlagen des Monats ---------- */
async function zipMonthDocs(cname, B, rows) {
  const ids = [...new Set(rows.flatMap((r) => r.docs))];
  if (!ids.length) return toast("Für diesen Monat sind keine Unterlagen verknüpft");
  const { data: docs } = await sb.from("documents").select("*").in("id", ids);
  const items = (docs || []).map((d) => { const r = rows.find((x) => x.e.id === d.employee_id); return { d, path: `${r ? r.cells.name : "ohne Zuordnung"}/${stdName(d, r?.e)}` }; });
  zipDocs(`${cname} Unterlagen ${B.sheet.slice(0, 2)}-20${B.sheet.slice(2)}.zip`, items);
}

/* ---------- Excel im bisherigen Layout (ein Blatt pro Monat, neuester zuerst) ---------- */
async function exportYear(cname, key, D) {
  toast("Excel wird erstellt …");
  if (!window.ExcelJS) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Personalakten Hub";
  const [y, mm] = key.split("-").map(Number);
  const EUR = '#,##0.00\\ [$€-1];[Red]\\-#,##0.00\\ [$€-1]';
  const fillOf = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
  let hourlyAll = new Map();
  // erst ab dem Monat, ab dem das Tool Daten hat (keine rückwirkend rekonstruierten Monate)
  const firstKey = [...D.logs.map((l) => (l.effective_from || l.changed_at).slice(0, 7)), ...D.inputs.map((i) => i.month.slice(0, 7))]
    .filter((x) => x.startsWith(String(y))).sort()[0] || key;
  for (let m = mm; m >= 1; m--) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k < firstKey && k !== key) break;
    const { B, rows } = buildMonth(k, D.emps, D.logs, D.inputs);
    if (!rows.length && m !== mm) continue;
    const ws = wb.addWorksheet(B.sheet, { views: [{ state: "frozen", xSplit: 2, ySplit: 8 }] });
    LL.COLS.forEach(([, , w], i) => { ws.getColumn(i + 1).width = w; });
    ws.mergeCells("A1:N1");
    Object.assign(ws.getCell("A1"), { value: `${cname} Lohnliste` });
    ws.getCell("A1").font = { bold: true, size: 14 }; ws.getCell("A1").alignment = { horizontal: "center" };
    ws.getCell("B3").value = "Monat"; ws.getCell("B3").font = { bold: true };
    ws.getCell("C3").value = new Date(Date.UTC(y, m - 1, 1)); ws.getCell("C3").numFmt = "mmm-yy";
    [["Legende:", LL.LEGEND, true], ["Änderungen akt. Monat = Zelle grün markieren", LL.GREEN], ["Änderungen für Folgemonat", LL.BLUE],
     ["Stundenlöhner", LL.ORANGE], ["Neuer Mitarbeiter = ganze Zeile grün", LL.GREEN]].forEach(([t, c, b], i) => {
      const cell = ws.getCell(2 + i, 13); cell.value = t; cell.fill = fillOf(c); if (b) cell.font = { bold: true };
    });
    const hr = ws.getRow(8);
    LL.COLS.forEach(([, h], i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true }; c.alignment = { wrapText: true, vertical: "middle" }; c.border = { top: thin, bottom: thin, left: thin, right: thin }; });
    hr.height = 30;
    rows.forEach((r, n) => {
      const row = ws.getRow(9 + n), c = r.cells, rn = 9 + n;
      const pn = /^\d+$/.test(String(c.pers_nr)) ? Number(c.pers_nr) : c.pers_nr || null;
      const vals = { pers_nr: pn, name: c.name, entry_date: c.entry_date || null, exit_date: c.exit_date || null,
        weekly_hours: c.weekly_hours === "" ? null : Number(c.weekly_hours),
        pay: r.hourly ? (c.wage ? { formula: `G${rn}*${Number(c.wage)}`, result: c.hours !== "" ? Number(c.hours) * Number(c.wage) : 0 } : null) : (c.pay == null ? null : Number(c.pay)),
        hours: c.hours === "" ? null : Number(c.hours), overtime: c.overtime === "" ? null : Number(c.overtime),
        commission: c.commission === "" ? null : Number(c.commission), other_label: c.other_label || null,
        other_amount: c.other_amount === "" ? null : Number(c.other_amount), bvg: c.bvg === "" ? null : Number(c.bvg), comment: c.comment || null };
      LL.COLS.forEach(([k], i) => {
        const cell = row.getCell(i + 1);
        cell.value = vals[k];
        cell.border = { top: thin, bottom: thin, left: thin, right: thin };
        if (["pay", "commission", "other_amount", "bvg"].includes(k)) cell.numFmt = EUR;
        if (["weekly_hours", "hours", "overtime"].includes(k)) cell.numFmt = "0.##";
        if (k === "comment") cell.alignment = { wrapText: true, vertical: "top" };
        const bg = r.isNew ? LL.GREEN : r.marks[k];
        if (bg) cell.fill = fillOf(bg);
      });
      if (r.hourly) hourlyAll.set(r.e.id, r);
    });
  }
  const sh = wb.addWorksheet("Stundenlohnbasis");
  sh.columns = [{ header: "Pers.Nr.", width: 10.9 }, { header: "Name", width: 32.7 }, { header: "wöchentl.\nArbeitszeit", width: 12 }, { header: "Bemerkung", width: 40 }];
  sh.getRow(1).font = { bold: true }; sh.getRow(1).alignment = { wrapText: true };
  [...hourlyAll.values()].forEach((r) => sh.addRow([/^\d+$/.test(String(r.cells.pers_nr)) ? Number(r.cells.pers_nr) : r.cells.pers_nr || null, r.cells.name,
    r.cells.weekly_hours === "" ? null : Number(r.cells.weekly_hours), r.cells.wage ? `Stundenlohn ${eur(r.cells.wage)}` : ""]));
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${y}_${cname}_Lohnbuchhaltungstabelle.xlsx`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast("Excel heruntergeladen");
}
