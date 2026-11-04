// Parse and validate every OSM opening_hours value with opening_hours.js (the reference OSM parser) and evaluate it
// for a reference week. Output is only used for statistics and quality checks — the web map evaluates the same
// opening_hours strings live in the browser (method B, no 168 columns in the data).
//
//   TZ=Europe/Berlin node pipeline/eval_hours.mjs build/cafes_min.json build/hours_eval.json
//
// Reference week: Mon 9 – Sun 15 Nov 2026 — no public or school holiday in Berlin.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const opening_hours = require("opening_hours");

export const REF_MONDAY = [2026, 10, 9];          // JS month index: 10 = November
const NOMINATIM = { lat: 52.52, lon: 13.405, address: { country_code: "de", state: "Berlin" } };

const [, , inFile, outFile] = process.argv;
const cafes = JSON.parse(fs.readFileSync(inFile, "utf8"));

const out = [];
let n = { missing: 0, ok: 0, warn: 0, error: 0 };
for (const c of cafes) {
  const r = { id: c.id };
  if (!c.oh) { r.status = "missing"; n.missing++; out.push(r); continue; }
  let oh;
  try {
    oh = new opening_hours(c.oh, NOMINATIM, { mode: 0, locale: "en" });
  } catch (e) {
    r.status = "error"; r.error = String(e).split("\n")[0].slice(0, 200); n.error++; out.push(r); continue;
  }
  const w = oh.getWarnings();
  r.status = w.length ? "warn" : "ok"; n[r.status]++;
  if (w.length) r.warnings = w.map(s => s.split("\n")[0].slice(0, 160));
  // hourly state for the reference week, sampled at hh:30 — o / c / u, 168 chars
  let s = "";
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const t = new Date(REF_MONDAY[0], REF_MONDAY[1], REF_MONDAY[2] + d, h, 30);
    s += oh.getUnknown(t) ? "u" : (oh.getState(t) ? "o" : "c");
  }
  r.week = s;
  out.push(r);
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(JSON.stringify(n));
