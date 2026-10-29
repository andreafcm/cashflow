/* Regeln v1 – liest Werte aus digital signierten PDFs ohne KI.
   Ergebnis hat dieselbe Form wie die Claude-Extraktion (wert, zitat, seite, sicherheit),
   damit Prüfbildschirm und Bestätigen unverändert funktionieren.
   WICHTIG: Die Muster sind allgemein gehalten. Sobald Muster-PDFs der echten Vorlagen
   vorliegen, die Formulierungen hier anpassen (Abschnitt MUSTER). */
"use strict";
const Regeln = (() => {
  const VERSION = "regeln-v1";
  const MONATE = { januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
  const ZAHLWORT = { ein: 1, eins: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 };
  const DATE = String.raw`(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{1,2}\.\s?(?:Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4})`;
  const MONEY = String.raw`(?:(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:€|EUR|Euro)|(?:€|EUR)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?))`;
  const ND = String.raw`(?:[^.\n]|\.(?=\d))`; // beliebiges Zeichen im Satz; Punkt nur als Tausendertrenner
  const NUM = String.raw`(\d+(?:,\d+)?)`;

  const pad = (n) => String(n).padStart(2, "0");
  function isoDate(s) {
    if (!s) return null;
    s = s.replace(/\s/g, "");
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    m = s.match(/^(\d{1,2})\.([A-Za-zäÄ]+)(\d{4})$/);
    if (m && MONATE[m[2].toLowerCase()]) return `${m[3]}-${pad(MONATE[m[2].toLowerCase()])}-${pad(m[1])}`;
    return null;
  }
  const num = (s) => s == null ? null : Number(String(s).replace(/\./g, "").replace(",", "."));
  const money = (m) => num(m[1] ?? m[2]);

  /* ---------- Text aus PDF (pdf.js) ---------- */
  async function pdfText(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [], form = {}, items = [], widgets = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let t = "";
      for (const it of tc.items) {
        t += it.str; t += it.hasEOL ? "\n" : " ";
        if (it.str.trim()) items.push({ p, str: it.str.trim(), x0: it.transform[4], x1: it.transform[4] + it.width, y: it.transform[5] });
      }
      pages.push(t.replace(/[ \t]+/g, " ").replace(/(\w)-\n(\w)/g, "$1$2"));
      for (const a of await page.getAnnotations()) {
        if (!a.fieldName) continue;
        const v = a.fieldValue == null ? "" : String(a.fieldValue);
        widgets.push({ p, name: a.fieldName, box: a.checkBox || a.radioButton, on: (a.checkBox || a.radioButton) ? (v !== "" && v !== "Off") : null, value: v, rect: a.rect });
        if (v !== "" && v !== "Off") form[a.fieldName] = v;
      }
    }
    return { pages, form, items, widgets };
  }

  /* ---------- Suche mit Fundstelle ---------- */
  function sentenceAround(text, idx, len) {
    let a = 0;
    for (const m of text.slice(0, idx).matchAll(/\.(?!\d)|\n/g)) a = m.index + 1;
    const rest = text.slice(idx + len).search(/\.(?=\s|$)|\n/);
    const b = rest === -1 ? text.length : idx + len + rest + 1;
    return text.slice(a, b).replace(/\s+/g, " ").trim().slice(0, 220);
  }
  function find(pages, re) {
    for (let p = 0; p < pages.length; p++) {
      const m = re.exec(pages[p]); re.lastIndex = 0;
      if (m) return { m, seite: p + 1, zitat: sentenceAround(pages[p], m.index, m[0].length) };
    }
    return null;
  }
  const leer = () => ({ wert: null, zitat: "", seite: null, sicherheit: "niedrig" });
  const feld = (wert, hit, sicherheit = "hoch") => wert === null || wert === undefined || Number.isNaN(wert) ? leer() : { wert, zitat: hit?.zitat || "", seite: hit?.seite || null, sicherheit };
  const re = (s, f = "i") => new RegExp(s, f);
  function grab(pages, patterns, conv, sicherheit = "hoch") {
    for (const p of patterns) { const h = find(pages, re(p)); if (h) { const v = conv(h.m); if (v !== null && v !== undefined && !Number.isNaN(v)) return feld(v, h, sicherheit); } }
    return leer();
  }
  const firstDate = (m) => isoDate(m[m.length - 1] ?? m[1]);
  function formVal(form, keys) {
    for (const [k, v] of Object.entries(form)) if (keys.some((x) => k.toLowerCase().includes(x))) return v;
    return null;
  }

  /* ---------- Dateiname ---------- */
  const CODES = { AV: "AV", "ÄV": "AEV", AEV: "AEV", "KÜ": "KUE", KUE: "KUE", AHV: "AHV", PB: "PB", GV: "GV", ARBEITSERLAUBNIS: "ARBEITSERLAUBNIS", AT: "ARBEITSERLAUBNIS", IMMA: "IMMA", IMMATRIKULATIONSBESCHEINIGUNG: "IMMA", PASS: "PASS" };
  function ausDateiname(name) {
    const n = name.normalize("NFC").replace(/\.[^.]+$/, "");
    const out = { typ: null, datum: null, nachname: null, vorname: null, entwurf: /entwurf/i.test(n), detail: "" };
    const m = n.match(/^(\d{4}-\d{2}(?:-\d{2})?)_([^_]+)_(.*)$/);
    if (m) {
      out.datum = m[1].length === 10 ? m[1] : null;
      out.typ = CODES[m[2].toUpperCase()] || null;
      const parts = m[3].split("_"); const who = parts.pop(); out.detail = parts.filter((x) => !/^entwurf$/i.test(x)).join("_");
      const w = who.split(",").map((s) => s.trim());
      if (w.length === 2 && w[0] && w[1]) { out.nachname = w[0]; out.vorname = w[1]; }
    } else {
      if (/^pass\b/i.test(n)) out.typ = "PASS";
      if (/erkl[äa]rung zum besch[äa]ftigungsverh/i.test(n)) out.typ = "ERKLAERUNG_BESCHAEFTIGUNG";
      if (/immatrikulation/i.test(n)) out.typ = "IMMA";
    }
    return out;
  }
  function typAusText(t) {
    const head = t.slice(0, 1500).toLowerCase();
    const TITEL = [["AHV", /aufhebungsvertrag/], ["AEV", /änderungsvereinbarung|änderung zum arbeitsvertrag|änderungsvertrag|nachtrag zum arbeitsvertrag/],
      ["KUE", /kündigung/], ["AV", /praktikumsvertrag|arbeitsvertrag/], ["GV", /geheimhaltungsvereinbarung/], ["PB", /personalbogen|personalfragebogen/],
      ["IMMA", /immatrikulationsbescheinigung|studienbescheinigung/], ["ARBEITSERLAUBNIS", /aufenthaltstitel|aufenthaltserlaubnis|arbeitserlaubnis/]];
    const hit = TITEL.map(([k, r]) => [k, head.search(r)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0];
    if (hit) return hit[0];
    const s = head;
    if (/aufhebungsvertrag/.test(s)) return "AHV";
    if (/änderungsvertrag|änderungsvereinbarung|nachtrag zum arbeitsvertrag/.test(s)) return "AEV";
    if (/kündigung/.test(s)) return "KUE";
    if (/arbeitsvertrag/.test(s)) return "AV";
    if (/personalbogen|personalfragebogen/.test(s)) return "PB";
    if (/immatrikulationsbescheinigung|studienbescheinigung/.test(s)) return "IMMA";
    if (/aufenthaltstitel|aufenthaltserlaubnis|arbeitserlaubnis/.test(s)) return "ARBEITSERLAUBNIS";
    return null;
  }

  /* ================= MUSTER je Dokumenttyp ================= */
  const P = {
    beginn: [String.raw`(?:mit Wirkung )?ab dem\s+` + DATE + String.raw`(?=[^.]{0,140}?(?:einzustellen|\bein\b|eingestellt|beschäftigt))`, String.raw`(?:beginnt|Beginn des Arbeitsverh[äa]ltnisses|Eintrittsdatum|Eintritt)\D{0,40}?(?:am|zum|:)?\s*` + DATE],
    befristetBis: [String.raw`befristet\D{0,30}?(?:bis(?:\s+zum)?|zum|endet am)\s+` + DATE, String.raw`endet${ND}{0,40}?(?:am|mit Ablauf des|zum)\s+` + DATE],
    probezeit: [String.raw`Probezeit\D{0,40}?(\d+|ein|einen|zwei|drei|vier|fünf|sechs)\s+Monat`, String.raw`(\d+|ein|einen|zwei|drei|vier|fünf|sechs)\s+Monate?\D{0,90}?Probezeit`],
    woche: [String.raw`wöchentliche[n]?\s+(?:regelmäßige\s+)?Arbeitszeit\D{0,110}?` + NUM + String.raw`\s*(?:Wochen)?stunden(?!\s*/)`, NUM + String.raw`\s*Stunden\s*(?:pro|je|in der|/)\s*Woche`,
      NUM + String.raw`\s*Stunden\s+wöchentlich`, String.raw`wöchentlich\s+` + NUM + String.raw`\s*Stunden`, String.raw`Arbeitszeit\s+beträgt\D{0,110}?` + NUM + String.raw`\s*(?:Wochen)?stunden`, NUM + String.raw`\s*Wochenstunden`],
    monat: [NUM + String.raw`\s*Stunden\s*(?:pro|je|im|/)\s*Monat`, String.raw`monatliche[n]?\s+Arbeitszeit\D{0,40}?` + NUM + String.raw`\s*Stunden`],
    gehalt: [String.raw`(?:Bruttogrundentgelt|Bruttoarbeitsentgelt|Bruttoentgelt|Grundentgelt|Unterhaltsbeihilfe)${ND}{0,60}?` + MONEY, String.raw`(?:Bruttomonatsgehalt|monatliche[sn]?\s+(?:Brutto)?(?:gehalt|vergütung)|Monatsgehalt|Gehalt)${ND}{0,80}?` + MONEY],
    stundenlohn: [String.raw`Stundenlohn${ND}{0,60}?` + MONEY, MONEY + String.raw`\s*(?:brutto\s*)?(?:pro|je|/)\s*(?:Arbeits)?stunde`],
    urlaub: [String.raw`(?:Jahresurlaub|Mindesturlaub)${ND}{0,40}?(\d+)\s*(?:Arbeits|Werk|Urlaubs)?tage`, String.raw`insgesamt\s+(\d+)\s*(?:Arbeits|Werk)?tage`, String.raw`Urlaubsanspruch\D{0,60}?(\d+)\s*(?:Arbeits|Werk)?tage`, String.raw`(\d+)\s*(?:Arbeitstage|Werktage|Tage)\s*(?:bezahlten\s+)?(?:Erholungs)?urlaub`],
    taetigkeit: [String.raw`\bals\s+([A-ZÄÖÜ][\wäöüß/\-]+(?:\s+[A-ZÄÖÜ][\wäöüß/\-]+)?)\s+(?:in dem|im|für den|in der)\s+Bereich`, String.raw`\bals\s+(?:eine?r?\s+)?([A-ZÄÖÜ][\wäöüßÄÖÜ/\- ]{2,60}?)\s+(?:eingestellt|beschäftigt|tätig)`, String.raw`(?:eingestellt als|beschäftigt als|Tätigkeit als|tätig als|Position:?)\s+(?:eine?r?\s+)?([A-ZÄÖÜ][\wäöüßÄÖÜ/\- ]{2,60}?)(?=[,.;\n]| im | in | ab | zum )`],
    bereich: [String.raw`(?:für den|in dem|im)\s+Bereich\s+([A-ZÄÖÜ][\wäöüß/\-]+(?:\s*(?:,|und|&)\s*[A-ZÄÖÜ][\wäöüß/\-]+)*)`],
    berechnet: [String.raw`Berechnung(?:en)?\s+(?:der|den|ist der)\s+` + DATE],
    gueltigAb: [String.raw`(?:mit Wirkung (?:zum|ab|vom)|gilt ab|ab dem|Wirkung zum|ab)\s+` + DATE],
    ende: [String.raw`(?:fristgerecht|ordentlich|fristlos|hiermit)?${ND}{0,80}?(?:zum|mit Ablauf des|endet am|endet mit Ablauf des|beendet zum)\s+` + DATE],
  };

  const BESCH = [["werkstudent", /werkstudent/i], ["minijob", /geringfügig|minijob|520|556/i], ["ausbildung", /ausbildungsvertrag|auszubildende/i],
    ["praktikum", /praktik/i], ["aushilfe", /aushilfe/i], ["teilzeit", /teilzeit/i], ["vollzeit", /vollzeit/i]];

  function av(pages, hinweise = []) {
    const all = pages.join("\n");
    const ph = all.match(/\b\d+\s*\/\s*\d+\s*\/\s*\d+\s*(?:Wochen)?stunden/i);
    if (ph) hinweise.push({ art: "widerspruch", text: `Platzhalter „${ph[0]}“ nicht ausgefüllt – Arbeitszeit bitte prüfen.`, seite: null });
    const mu = all.match(/weitere\s+bezahlte\s+(\d+)\s+Mehrurlaubstage/i);
    if (mu) hinweise.push({ art: "sonstiges", text: `Zusätzlich bis zu ${mu[1]} freiwillige Mehrurlaubstage (jährliche Entscheidung) – Urlaubstage ggf. anpassen.`, seite: null });
    const f = {
      vertragsbeginn: grab(pages, P.beginn, firstDate),
      befristet: leer(), befristet_bis: grab(pages, P.befristetBis, firstDate),
      probezeit_monate: grab(pages, P.probezeit, (m) => /^\d+$/.test(m[1]) ? +m[1] : ZAHLWORT[m[1].toLowerCase()] ?? null),
      taetigkeit: grab(pages, P.taetigkeit, (m) => m[1].trim(), "mittel"),
      beschaeftigungsart: leer(),
      wochenarbeitszeit_std: grab(pages, P.woche, (m) => num(m[1])),
      monatsarbeitszeit_std: grab(pages, P.monat, (m) => num(m[1])),
      verguetungsart: leer(),
      gehalt_brutto_monat: grab(pages, P.gehalt, money),
      stundenlohn_brutto: grab(pages, P.stundenlohn, money),
      urlaubstage_jahr: grab(pages, P.urlaub, (m) => +m[1]),
      sonstige_bezuege: [], arbeitsort: leer(), kuendigungsfrist: leer(),
      bereich: grab(pages, P.bereich, (m) => m[1].trim(), "mittel"),
    };
    for (let p = 0; p < pages.length; p++) for (const m of pages[p].matchAll(re(String.raw`Zuschlag\s+in\s+Höhe\s+von\s+` + MONEY + String.raw`([^.\n]{0,40})`, "gi"))) {
      f.sonstige_bezuege.push({ bezeichnung: ("Zuschlag " + (m[3] || "")).replace(/\s+/g, " ").trim(), betrag: money(m), turnus: /monat/i.test(m[3] || "") ? "monatlich" : "unklar",
        zitat: sentenceAround(pages[p], m.index, m[0].length), seite: p + 1, sicherheit: "mittel" });
    }
    if (f.befristet_bis.wert) f.befristet = { ...f.befristet_bis, wert: true };
    else if (/unbefristet/i.test(all)) f.befristet = feld(false, find(pages, /unbefristet/i));
    for (const [k, r] of BESCH) { const h = find(pages, r); if (h) { f.beschaeftigungsart = feld(k, h, "mittel"); break; } }
    if (f.stundenlohn_brutto.wert) { f.verguetungsart = { ...f.stundenlohn_brutto, wert: "stundenlohn" }; }
    else if (f.gehalt_brutto_monat.wert) { f.verguetungsart = { ...f.gehalt_brutto_monat, wert: "monatsgehalt" }; }
    return f;
  }

  function saetze(pages) {
    const out = [];
    pages.forEach((t, p) => t.replace(/\s+/g, " ").split(/(?<=[.;:])\s+(?=[A-ZÄÖÜ§(])/).forEach((s) => { s = s.trim(); if (s) out.push({ s, seite: p + 1 }); }));
    return out;
  }
  function aevSaetze(pages) {
    const ch = [], effs = [];
    const EFF = re(String.raw`(?<!beginnend\s)(?:mit Wirkung (?:zum|ab|vom)|ab dem|ab)\s+` + DATE);
    const S = saetze(pages);
    const docEffs = [...new Set(S.map((x) => x.s.match(EFF)).filter(Boolean).map((m) => isoDate(m[1])))];
    for (const { s, seite } of S) {
      if (!/abänderung|ab dem|mit wirkung|erhöht|verlängert|entfrist|unbefristet|geändert|angehoben/i.test(s)) continue;
      const em = s.match(EFF);
      const eff = em ? isoDate(em[1]) : docEffs.length === 1 ? docEffs[0] : null;
      const rest = em ? s.slice(em.index + em[0].length) : s;
      const sicher = em || docEffs.length === 1 ? "hoch" : "mittel";
      const add = (art, neu, einheit, txt, alt = null) => { ch.push({ art, alter_wert: alt == null ? null : String(alt), neuer_wert: txt, neuer_wert_normiert: neu == null ? null : String(neu), einheit,
        zitat: s.slice(0, 220), seite, sicherheit: sicher }); if (eff) effs.push(eff); };
      let m;
      if (/entfrist|unbefristet|Befristung entfällt/i.test(s)) add("entfristung", null, "text", "unbefristet");
      else if (/verlängert|befristet bis/i.test(s) && ((m = s.match(re(String.raw`verlängert\D{0,40}?(?:bis(?:\s+zum)?|zum)\s+` + DATE))) || (m = rest.match(re(String.raw`(?:bis(?:\s+zum)?|zum)\s+` + DATE)))))
        add("befristung_verlaengerung", isoDate(m[1]), "datum", m[0]);
      if (/Arbeitszeit|Wochenstunden/i.test(s)) {
        if ((m = s.match(re(String.raw`von\s+` + NUM + String.raw`\s*(?:Stunden\s*)?auf\s+` + NUM + String.raw`\s*(?:Wochen)?stunden`)))) add("wochenarbeitszeit", num(m[2]), "std_woche", m[0], num(m[1]));
        else if ((m = rest.match(re(String.raw`(?:wöchentlich\s+)?` + NUM + String.raw`\s*(?:Wochen)?stunden`)))) add("wochenarbeitszeit", num(m[1]), "std_woche", m[0]);
      }
      if (/entgelt|gehalt|vergütung|stundenlohn/i.test(s)) {
        if ((m = s.match(re(String.raw`von\s+` + MONEY + String.raw`\s+auf\s+` + MONEY + String.raw`\s*(?:brutto\s*)?(monatlich|stündlich|pro Stunde|pro Monat|je Stunde)?`)))) {
          const stunde = /stunde|stündlich/i.test(m[5] || "") || /stundenlohn/i.test(s);
          add(stunde ? "stundenlohn" : "gehalt", num(m[3] ?? m[4]), stunde ? "eur_stunde" : "eur_monat", m[0], num(m[1] ?? m[2]));
        } else if ((m = rest.match(re(MONEY + String.raw`\s*(?:brutto\s*)?(monatlich|stündlich|pro Stunde|pro Monat|je Stunde)?`)))) {
          const stunde = /stündlich|stunde/i.test(m[3] || "") || /stundenlohn/i.test(s);
          add(stunde ? "stundenlohn" : "gehalt", money(m), stunde ? "eur_stunde" : "eur_monat", m[0]);
        }
      }
      if (/urlaub/i.test(s) && (m = rest.match(/(\d+)\s*(?:Urlaubs|Arbeits|Werk)?tage/i))) add("urlaubstage", +m[1], "tage_jahr", m[0]);
    }
    return { ch, effs };
  }
  function aev(pages, detail, hinweise = []) {
    const f = { aenderungsnummer: leer(), gueltig_ab: grab(pages, P.gueltigAb, firstDate), aenderungen: [] };
    const nr = find(pages, /(\d+)\.\s*Änderung/i); if (nr) f.aenderungsnummer = feld(+nr.m[1], nr, "mittel");
    const S1 = aevSaetze(pages);
    if (S1.ch.length) {
      f.aenderungen = S1.ch;
      const u = [...new Set(S1.effs)].sort();
      if (u.length) { const h = S1.ch.find((c) => c.sicherheit === "hoch"); f.gueltig_ab = { wert: u[0], zitat: h.zitat, seite: h.seite, sicherheit: "hoch" }; }
      if (u.length > 1) hinweise.push({ art: "sonstiges", text: `Änderungen gelten ab verschiedenen Daten (${u.map((d) => d.split("-").reverse().join(".")).join(", ")}) – „Gültig ab“ je Änderung prüfen.`, seite: null });
      const d = (detail || "").toLowerCase();
      const want = /gehalt|lohn/.test(d) ? ["gehalt", "stundenlohn"] : /stunden|arbeitszeit/.test(d) ? ["wochenarbeitszeit"] : /verl[äa]ng/.test(d) ? ["befristung_verlaengerung", "entfristung"] : null;
      if (want && !f.aenderungen.some((a) => want.includes(a.art))) hinweise.push({ art: "widerspruch", text: `Dateiname nennt „${detail}“, im Text aber keine passende Änderung gefunden.`, seite: null });
      return f;
    }
    const add = (art, h, neu, einheit, alt = null, sicher = "hoch") => h && f.aenderungen.push({ art, alter_wert: alt, neuer_wert: h.m[0].trim(), neuer_wert_normiert: neu == null ? null : String(neu), einheit, zitat: h.zitat, seite: h.seite, sicherheit: sicher });
    let h;
    // Arbeitszeit: "von 20 auf 25 Stunden" oder "beträgt ab ... 25 Stunden pro Woche"
    if ((h = find(pages, re(String.raw`von\s+` + NUM + String.raw`\s*(?:Stunden\s*)?auf\s+` + NUM + String.raw`\s*(?:Wochen)?stunden`)))) add("wochenarbeitszeit", h, num(h.m[2]), "std_woche", h.m[1]);
    else if ((h = find(pages, re(P.woche[0]))) || (h = find(pages, re(P.woche[1])))) add("wochenarbeitszeit", h, num(h.m[1]), "std_woche", null, "mittel");
    // Gehalt / Stundenlohn
    if ((h = find(pages, re(String.raw`(?:gehalt|Vergütung)${ND}{0,120}?von\s+` + MONEY + String.raw`\s+auf\s+` + MONEY)))) add("gehalt", h, num(h.m[3] ?? h.m[4]), "eur_monat", String(num(h.m[1] ?? h.m[2])));
    else if ((h = find(pages, re(String.raw`(?:gehalt|Vergütung)${ND}{0,120}?auf\s+` + MONEY)))) add("gehalt", h, money(h.m), "eur_monat");
    else if ((h = find(pages, re(P.gehalt[0])))) add("gehalt", h, money(h.m), "eur_monat", null, "mittel");
    if ((h = find(pages, re(P.stundenlohn[0])))) add("stundenlohn", h, money(h.m), "eur_stunde", null, "mittel");
    // Befristung
    if ((h = find(pages, /unbefristet|Befristung entfällt|entfristet/i))) f.aenderungen.push({ art: "entfristung", alter_wert: null, neuer_wert: h.m[0], neuer_wert_normiert: null, einheit: "text", zitat: h.zitat, seite: h.seite, sicherheit: "mittel" });
    else if ((h = find(pages, re(String.raw`(?:verlängert|befristet)${ND}{0,60}?(?:bis(?:\s+zum)?|zum)\s+` + DATE)))) add("befristung_verlaengerung", h, firstDate(h.m), "datum");
    // Urlaub
    if ((h = find(pages, re(P.urlaub[0]))) || (h = find(pages, re(P.urlaub[1])))) add("urlaubstage", h, +h.m[1], "tage_jahr", null, "mittel");
    // Dateiname-Detail (Gehalt/Stunden/Verlängerung) bevorzugen: andere Treffer nur "mittel"
    const d = (detail || "").toLowerCase();
    const want = /gehalt|lohn/.test(d) ? ["gehalt", "stundenlohn"] : /stunden|arbeitszeit/.test(d) ? ["wochenarbeitszeit"] : /verl[äa]ng/.test(d) ? ["befristung_verlaengerung", "entfristung"] : null;
    if (want) f.aenderungen.forEach((a) => { if (!want.includes(a.art)) a.sicherheit = "niedrig"; });
    return f;
  }

  function kue(pages) {
    const all = pages.join("\n").toLowerCase();
    const f = { kuendigung_durch: leer(), art: leer(), beendigungsdatum: grab(pages, [...P.berechnet, ...P.ende], firstDate), hilfsweise_naechstmoeglich: leer(),
      zugang_datum: leer(), freistellung: leer(), freistellung_ab: leer(), resturlaub_tage: leer() };
    let h;
    if ((h = find(pages, /kündigen\s+(?:wir|hiermit\s+das)|kündigt die Firma|seitens des Arbeitgebers/i))) f.kuendigung_durch = feld("arbeitgeber", h, "mittel");
    else if ((h = find(pages, /(?:hiermit\s+)?kündige\s+ich/i))) f.kuendigung_durch = feld("arbeitnehmer", h, "mittel");
    if ((h = find(pages, /fristlos|außerordentlich/i))) f.art = feld("ausserordentlich_fristlos", h, "mittel");
    else if ((h = find(pages, /ordentlich|fristgerecht/i))) f.art = feld("ordentlich", h, "mittel");
    if ((h = find(pages, /hilfsweise|nächstmöglichen Zeitpunkt|nächstmöglichen Termin/i))) f.hilfsweise_naechstmoeglich = feld(true, h);
    if (/freigestellt|freistellung/.test(all)) f.freistellung = feld(true, find(pages, /freigestellt|freistellung/i), "mittel");
    f.resturlaub_tage = grab(pages, [String.raw`Resturlaub\D{0,40}?(\d+(?:,\d+)?)\s*(?:Arbeits)?tage`], (m) => num(m[1]), "mittel");
    return f;
  }

  function ahv(pages) {
    const fr = find(pages, re(String.raw`ab\s+dem\s+` + DATE + String.raw`(?:[^.]|\.(?=\d)){0,220}?freigestellt`));
    return { beendigungsdatum: grab(pages, [String.raw`mit Wirkung zum\s+` + DATE + String.raw`(?=\s+aufgehoben)`, String.raw`(?:endet|beendet)${ND}{0,80}?(?:mit Ablauf des|zum|am)\s+` + DATE], firstDate),
      abfindung_brutto: grab(pages, [String.raw`Abfindung${ND}{0,80}?` + MONEY], money),
      abfindung_faellig: leer(), freistellung: fr ? feld(true, fr) : leer(), freistellung_ab: fr ? feld(isoDate(fr.m[1]), fr) : leer(),
      resturlaub_regelung: grab(pages, [String.raw`(Resturlaub${ND}{5,160})`], (m) => m[1].trim(), "mittel"), sonstige_bezuege: [] };
  }

  /* ---------- Formularfelder über ihre Position den gedruckten Beschriftungen zuordnen ---------- */
  function rowItems(items, w) {
    const mid = (w.rect[1] + w.rect[3]) / 2;
    return items.filter((i) => i.p === w.p && Math.abs(i.y + 4 - mid) <= 7);
  }
  function labelLeft(items, w) {
    const c = rowItems(items, w).filter((i) => i.x1 <= w.rect[0] + 3);
    return c.length ? c.reduce((a, b) => (b.x1 > a.x1 ? b : a)) : null;
  }
  function labelForBox(items, w) {
    const row = rowItems(items, w);
    const right = row.filter((i) => i.x0 >= w.rect[2] - 4).sort((a, b) => a.x0 - b.x0)[0];
    if (right && right.x0 - w.rect[2] <= 20) return right;
    const left = row.filter((i) => i.x1 <= w.rect[0] + 4).sort((a, b) => b.x1 - a.x1)[0];
    if (left && w.rect[0] - left.x1 <= 20) return left;
    return null;
  }
  const key = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  /* Nur diese Beschriftungen werden gelesen. Steuer-ID, SV-Nr., IBAN und Konfession: vom DSB freigegeben.
     BIC, E-Mail, Telefon, Geschlecht, Schwerbehinderung und Schwangerschaft werden bewusst NICHT ausgelesen. */
  const PB_TEXT = { vorname: "vorname", nachname: "nachname", gebdatum: "geburtsdatum", geburtsdatum: "geburtsdatum", gebort: "geburtsort", geburtsort: "geburtsort",
    nationalitat: "staatsangehoerigkeit", staatsangehorigkeit: "staatsangehoerigkeit", adresse: "adresse", anschrift: "adresse", krankenkasse: "krankenkasse",
    familienstand: "familienstand", steuerklasse: "steuerklasse", steuerid: "steuer_id", steueridentifikationsnummer: "steuer_id",
    svnr: "sv_nummer", svnummer: "sv_nummer", sozialversicherungsnummer: "sv_nummer", rentenversicherungsnummer: "sv_nummer", iban: "iban",
    konfessionreligion: "konfession", konfession: "konfession", religion: "konfession", jakinderfreibetrag: "kinderfreibetraege", kinderfreibetrag: "kinderfreibetraege", kinderfreibetrage: "kinderfreibetraege" };
  const SCHUL = ["hauptschulabschluss", "volksschulabschluss", "mittlerereifegleichwertig", "mittlerereife", "abitur", "fachabitur"];
  const BERUF = ["ausbildung", "meister", "techniker", "bachelor", "master", "diplom", "magister", "staatsexamen", "promotiondrprof", "promotion"];
  function konf(v) { v = (v || "").trim().toLowerCase();
    if (!v || /^[-–—]$|^(keine?|ohne|konfessionslos|nein|vd|ohne konfession)$/.test(v)) return "keine";
    if (/röm|kath|\brk\b/.test(v)) return "rk"; if (/evang|luth|reform|\bev\b|\blt\b|\brf\b/.test(v)) return "ev"; return "sonstige"; }
  function famst(v) { v = (v || "").toLowerCase(); return ["ledig", "verheiratet", "geschieden", "verwitwet"].find((x) => v.includes(x)) || (v.includes("lebenspartner") ? "eingetragene_lebenspartnerschaft" : v.includes("getrennt") ? "getrennt_lebend" : null); }
  function pbFormular(doc, f, r) {
    const { items, widgets } = doc;
    const src = (lab, val) => ({ zitat: `${lab.str}: ${val}`, seite: lab.p });
    for (const w of widgets.filter((x) => !x.box && x.value.trim())) {
      const lab = labelLeft(items, w); if (!lab) continue;
      const k = PB_TEXT[key(lab.str)]; if (!k) continue;          // alles andere wird nicht gelesen
      const v = w.value.trim(), s = src(lab, v);
      if (k === "vorname") r.mitarbeiter.vorname = feld(v, s);
      else if (k === "nachname") r.mitarbeiter.nachname = feld(v, s);
      else if (k === "geburtsdatum") { const d = isoDate((v.match(/\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/) || [])[0]); f.geburtsdatum = feld(d, s); r.mitarbeiter.geburtsdatum = feld(d, s); }
      else if (k === "adresse") {
        const plz = v.match(/\b(\d{5})\b\s*([^,]+)?/);
        f.strasse_hausnr = feld(v.split(",")[0].trim() || null, s, "mittel");
        if (plz) { f.plz = feld(plz[1], s); f.ort = feld((plz[2] || "").trim() || null, s, "mittel"); }
      }
      else if (k === "krankenkasse") f.krankenkasse = feld(v.split(/\s+/).filter((t) => !/\d/.test(t)).join(" ") || null, { ...s, zitat: `${lab.str}: (Name)` }, "mittel"); // Versichertennummer wird weggelassen
      else if (k === "familienstand") f.familienstand = feld(famst(v), s);
      else if (k === "steuerklasse") { const m = v.match(/\b(VI|IV|V|I{1,3}|[1-6])\b/); f.steuerklasse = feld(m ? ({ I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6" }[m[1]] || m[1]) : null, s); }
      else if (k === "kinderfreibetraege") { const m = v.match(/\d+(?:,\d)?/); f.kinderfreibetraege = feld(m ? num(m[0]) : null, s); }
      else if (k === "geburtsort") f.geburtsort = feld(v, s);
      else if (k === "steuer_id") f.steuer_id = feld(v.replace(/\s/g, ""), s);
      else if (k === "sv_nummer") f.sv_nummer = feld(v.replace(/\s/g, "").toUpperCase(), s);
      else if (k === "iban") f.iban = feld(v.replace(/\s/g, "").toUpperCase(), s);
      else if (k === "konfession") f.konfession = feld(konf(v), { ...s, zitat: `${lab.str}: (angegeben)` }, v.trim().length > 2 || /^[-–]$/.test(v.trim()) ? "hoch" : "mittel");
      else if (k === "staatsangehoerigkeit") f.staatsangehoerigkeit = feld(v, s);
    }
    for (const w of widgets.filter((x) => x.box && x.on)) {
      const opt = labelForBox(items, w); if (!opt) continue;
      const row = rowItems(items, w).sort((a, b) => a.x0 - b.x0)[0];
      const q = row && row !== opt ? key(row.str) : "";
      const o = key(opt.str), s = src(row && row !== opt ? row : opt, opt.str);
      if (q.startsWith("krankenversicherung")) {
        f.krankenversicherung_art = feld(o.includes("privat") ? "privat" : o.includes("famil") ? "familienversichert" : "gesetzlich", s);
        if (o.includes("freiwillig")) r.hinweise.push({ art: "sonstiges", text: "Krankenversicherung: freiwillig gesetzlich versichert.", seite: w.p });
      } else if (q.startsWith("dasistmein")) f.weitere_beschaeftigung = feld(o === "nebenjob", s, "mittel");
      else if (q.startsWith("student") && o === "ja") r.hinweise.push({ art: "sonstiges", text: "Laut Personalbogen Student/in – aktuelle Immatrikulationsbescheinigung nötig.", seite: w.p });
      else if (SCHUL.includes(o)) f.hoechster_schulabschluss = feld(opt.str, s);
      else if (BERUF.includes(o)) f.hoechste_berufsausbildung = feld(opt.str, s);
      else if (o === "keinen" || o === "unbekannt") {
        const schulSpalte = items.some((i) => i.p === w.p && key(i.str) === "abitur" && Math.abs(i.x0 - opt.x0) < 30);
        f[schulSpalte ? "hoechster_schulabschluss" : "hoechste_berufsausbildung"] = feld(opt.str, s, "mittel");
      }
      // Schwerbehinderung, Kinder, Schwangerschaft, Geschlecht: bewusst nicht gelesen
    }
  }

  function pb(pages, form) {
    const lbl = (labels, conv = (x) => x, sicher = "hoch") => {
      const fv = formVal(form, labels.map((l) => l.toLowerCase().replace(/[^a-zäöü]/g, "")));
      if (fv) return feld(conv(fv), { zitat: `Formularfeld: ${fv}`, seite: null }, "mittel");
      return grab(pages, labels.map((l) => String.raw`(?<![A-Za-zÄÖÜäöüß])` + l + String.raw`\s*[:\-]?\s*([^\n]{1,60})`), (m) => conv(m[1].trim()), sicher);
    };
    const famst = (v) => { v = v.toLowerCase(); return ["ledig", "verheiratet", "geschieden", "verwitwet"].find((x) => v.includes(x)) || (v.includes("lebenspartner") ? "eingetragene_lebenspartnerschaft" : v.includes("getrennt") ? "getrennt_lebend" : null); };
    return {
      geburtsdatum: lbl(["Geburtsdatum", "Geb\\.\\s?Datum"], (v) => isoDate((v.match(/\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/) || [])[0])),
      geburtsort: lbl(["Geburtsort", "Geb\\.\\s?Ort"]), staatsangehoerigkeit: lbl(["Staatsangehörigkeit", "Nationalität"]),
      strasse_hausnr: lbl(["Straße", "Strasse"]), plz: lbl(["PLZ", "Postleitzahl"], (v) => (v.match(/\d{5}/) || [null])[0]), ort: lbl(["Wohnort", "Ort"]),
      familienstand: lbl(["Familienstand"], famst),
      steuerklasse: lbl(["Steuerklasse", "Lohnsteuerklasse"], (v) => { const m = v.match(/\b(VI|IV|V|I{1,3}|[1-6])\b/); return m ? ({ I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6" }[m[1]] || m[1]) : null; }),
      kinderfreibetraege: lbl(["Kinderfreibeträge", "Kinderfreibetrag"], (v) => { const m = v.match(/\d+(?:,\d)?/); return m ? num(m[0]) : null; }),
      steuer_id: lbl(["Steuer-?\\s?ID", "Steueridentifikationsnummer"], (v) => (v.match(/\d[\d\s]{9,14}\d/) || [""])[0].replace(/\s/g, "") || null),
      sv_nummer: lbl(["SV-?\\s?Nr\\.?", "Sozialversicherungsnummer", "Rentenversicherungsnummer"], (v) => (v.replace(/\s/g, "").toUpperCase().match(/\d{8}[A-Z]\d{3}/) || [null])[0]),
      krankenkasse: lbl(["Krankenkasse"]), krankenversicherung_art: leer(),
      konfession: lbl(["Konfession(?:\\s?/\\s?Religion)?", "Religion"], konf), iban: lbl(["IBAN"], (v) => (v.replace(/\s/g, "").toUpperCase().match(/[A-Z]{2}\d{2}[A-Z0-9]{11,30}/) || [null])[0]),
      weitere_beschaeftigung: leer(), hoechster_schulabschluss: lbl(["Schulabschluss"], (x) => x, "mittel"), hoechste_berufsausbildung: lbl(["Berufsausbildung"], (x) => x, "mittel"),
    };
  }

  function imma(pages) {
    const f = { hochschule: grab(pages, [String.raw`((?:[A-ZÄÖÜ][\wäöüß\-]+\s+)?(?:Universität|Hochschule|Fachhochschule)[^\n,]{2,60})`], (m) => m[1].trim(), "mittel"),
      semester: grab(pages, [String.raw`((?:Wintersemester|Sommersemester|WiSe|SoSe|WS|SS)\s*\d{4}(?:\s*/\s*\d{2,4})?)`], (m) => m[1].replace(/\s+/g, " "), "hoch"),
      semester_beginn: leer(), semester_ende: grab(pages, [String.raw`(?:bis|Semesterende|endet am)\s*:?\s*` + DATE], firstDate),
      status: leer(), studiengang: grab(pages, [String.raw`Studiengang\s*:?\s*([^\n]{3,80})`], (m) => m[1].trim(), "mittel") };
    let h;
    if ((h = find(pages, /beurlaubt/i))) f.status = feld("beurlaubt", h, "mittel");
    else if ((h = find(pages, /immatrikuliert|eingeschrieben/i))) f.status = feld("immatrikuliert", h, "mittel");
    if (!f.semester_ende.wert && f.semester.wert) { // aus "WS 2025/26" ableiten
      const s = f.semester.wert, y = +(s.match(/\d{4}/) || [0])[0];
      if (y) f.semester_ende = { ...f.semester, wert: /^(W|Wi)/i.test(s) ? `${y + 1}-03-31` : `${y}-09-30`, sicherheit: "mittel" };
    }
    return f;
  }

  function aufenthalt(pages) {
    return { titel_art: grab(pages, [String.raw`((?:Aufenthaltserlaubnis|Niederlassungserlaubnis|Blaue Karte EU|Aufenthaltstitel)[^\n]{0,60})`], (m) => m[1].trim(), "mittel"),
      gueltig_ab: leer(), gueltig_bis: grab(pages, [String.raw`gültig\s+bis\s*:?\s*` + DATE], firstDate),
      erwerbstaetigkeit: leer(), auflagen: grab(pages, [String.raw`(Erwerbstätigkeit[^\n.]{3,120})`], (m) => m[1].trim(), "mittel"), arbeitgebergebunden: leer() };
  }

  /* ---------- Hauptfunktion ---------- */
  async function lesen(file) {
    const name = file.name, dn = ausDateiname(name);
    const ext = name.toLowerCase().split(".").pop();
    const hinweise = [];
    const base = (typ, status) => ({
      dokumenttyp: typ || "SONSTIGES", dokumentstatus: status,
      dokumentdatum: dn.datum ? { wert: dn.datum, zitat: "aus Dateiname", seite: null, sicherheit: "mittel" } : leer(),
      arbeitgeber: leer(),
      mitarbeiter: { nachname: dn.nachname ? { wert: dn.nachname, zitat: "aus Dateiname", seite: null, sicherheit: "mittel" } : leer(),
        vorname: dn.vorname ? { wert: dn.vorname, zitat: "aus Dateiname", seite: null, sicherheit: "mittel" } : leer(), geburtsdatum: leer(), personalnummer: leer() },
      hinweise, felder: {},
    });
    if (ext === "docx" || ext === "doc") {
      const r = base(dn.typ, "entwurf"); hinweise.push({ art: "sonstiges", text: "Word-Datei: wird nur abgelegt (meist Entwurf). Für die Auswertung die unterschriebene PDF hochladen.", seite: null });
      return { result: r, typ: dn.typ || "SONSTIGES", lesbar: false };
    }
    if (ext !== "pdf") {
      const r = base(dn.typ, "unklar"); hinweise.push({ art: "unleserlich", text: "Bild/Scan: kein Text lesbar. Bitte die benötigten Werte eintragen.", seite: null });
      return { result: r, typ: dn.typ || "SONSTIGES", lesbar: false };
    }
    const doc = await pdfText(await file.arrayBuffer());
    const { pages, form } = doc;
    const chars = pages.join("").replace(/\s/g, "").length;
    const typ = dn.typ || typAusText(pages.join("\n")) || "SONSTIGES";
    if (chars < 80 && !Object.keys(form).length) {
      const r = base(typ, "unklar"); hinweise.push({ art: "unleserlich", text: "Scan ohne Textebene: bitte die benötigten Werte eintragen (oder optional mit Claude auslesen).", seite: null });
      return { result: r, typ, lesbar: false };
    }
    const all = pages.join("\n");
    const signiert = /docusign envelope id|docusign-umschlag|signed by|elektronisch signiert|digital signiert|unterzeichnet von/i.test(all);
    const status = dn.entwurf || /\bentwurf\b/i.test(all.slice(0, 400)) ? "entwurf" : signiert ? "unterschrieben_beide" : "unklar";
    const r = base(typ, status);
    if (!signiert && ["AV", "AEV", "KUE", "AHV"].includes(typ)) hinweise.push({ art: "sonstiges", text: "Keine digitale Signatur (DocuSign) erkannt – Unterschriften prüfen.", seite: null });
    if (!dn.typ) hinweise.push({ art: "sonstiges", text: `Dateiname ohne Typ-Code – Typ „${typ}“ aus dem Text erkannt.`, seite: null });
    const ag = find(pages, /(?:zwischen\s+(?:der\s+)?|Arbeitgeber:?\s*)([A-ZÄÖÜ][\w&.\- ]{2,60}?(?:GmbH|AG|UG|KG|e\.K\.|mbH))/i) ||
      find(pages, /^\s*([A-ZÄÖÜ][\w&.\- ]{2,60}?(?:GmbH|AG|UG|KG|mbH))\s*,/m);
    if (ag) r.arbeitgeber = feld(ag.m[1].trim(), ag, "mittel");
    const gd = find(pages, re(String.raw`geb(?:oren)?\.?\s*(?:am)?\s*` + DATE));
    if (gd) r.mitarbeiter.geburtsdatum = feld(isoDate(gd.m[1]), gd);
    r.felder = typ === "AV" ? av(pages, hinweise) : typ === "AEV" ? aev(pages, dn.detail, hinweise) : typ === "KUE" ? kue(pages) : typ === "AHV" ? ahv(pages)
      : typ === "PB" ? (doc.widgets.some((w) => !w.box && w.value.trim()) ? (() => { const f = pb([], {}); pbFormular(doc, f, r); return f; })() : pb(pages, form)) : typ === "IMMA" ? imma(pages) : typ === "ARBEITSERLAUBNIS" ? aufenthalt(pages) : {};
    return { result: r, typ, lesbar: true, zeichen: chars };
  }

  return { VERSION, lesen, ausDateiname, isoDate, _pdfText: pdfText };
})();
