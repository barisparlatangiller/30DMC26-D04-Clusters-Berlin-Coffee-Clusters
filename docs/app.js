/* Where Berlin Brews — a week in coffee clusters · #30DayMapChallenge 2026 · Day 4 · Clusters */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

  // reference week: Mon 9 – Sun 15 Nov 2026 (no public or school holidays in Berlin); local wall-clock time
  const REF = [2026, 10, 9];
  const NOMI = { lat: 52.52, lon: 13.405, address: { country_code: "de", state: "Berlin" } };
  const refDate = (min) => new Date(REF[0], REF[1], REF[2], 0, min);     // minutes since Monday 00:00
  const WEEK = 7 * 1440;

  // cluster palette (12, distinguishable on light and dark basemaps)
  const PAL = ["#d9480f", "#1c7ed6", "#2b8a3e", "#ae3ec9", "#f59f00", "#0c8599", "#e64980", "#5f3dc4", "#74b816", "#c92a2a", "#1098ad", "#8f5b3a"];
  const S_OPEN_NOISE = "#6b4a33", S_CLOSED = "#b9b1a6", S_UNK = "#9c968c";

  const state = { day: 4, min: 870, mode: "open", eps: 250, minPts: 5, hulls: true, sel: null };
  let map, C, S, N = 0, X, Y, OH = [], IV = [], popup, playing = null;
  let lab = null, colorOf = null, prevColor = null, clusters = [], st = null;

  const j = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  Promise.all([j("data/cafes.geojson"), j("data/stats.json"), j("data/berlin.geojson").catch(() => null), j("data/bezirke.geojson").catch(() => null)])
    .then(([c, s, b, bz]) => { C = c; S = s; prep(); initMap(b, bz); initPanel(); })
    .catch((e) => { $("#loading").textContent = "Could not load the data: " + e.message; });

  // ------------------------------------------------------------------ opening hours (method B: one tag, evaluated live)
  function prep() {
    N = C.features.length;
    X = new Float64Array(N); Y = new Float64Array(N);
    const k = Math.cos(52.52 * Math.PI / 180) * 111320;          // fallback if no EPSG:25833 coordinates are shipped
    const from = new Date(REF[0], REF[1], REF[2] - 1), to = new Date(REF[0], REF[1], REF[2] + 7);
    const t0 = refDate(0).getTime();
    C.features.forEach((f, i) => {
      const [lon, lat] = f.geometry.coordinates;
      const q = f.properties;
      X[i] = q.x ?? lon * k; Y[i] = q.y ?? lat * 110574;           // DBSCAN in EPSG:25833 metres, as in the pipeline
      f.id = i; f.properties.i = i;
      const p = f.properties;
      OH[i] = null; IV[i] = null;
      if (!p.oh) return;
      try {
        const o = new opening_hours(p.oh, NOMI, { mode: 0, locale: "en" });
        OH[i] = o;
        // open intervals of the reference week as minutes since Monday 00:00: [start, end, unknown]
        IV[i] = o.getOpenIntervals(from, to).map(([a, b, u]) => [(a - t0) / 60000, (b - t0) / 60000, !!u]);
      } catch (e) { OH[i] = false; }
    });
  }
  // 0 closed · 1 open · 2 unknown
  function stateAt(i, m) {
    const iv = IV[i];
    if (!iv) return 2;
    for (const [a, b, u] of iv) {
      if (m >= a && m < b) return u ? 2 : 1;
      if (m + WEEK >= a && m + WEEK < b) return u ? 2 : 1;       // Sunday-night spill into the next Monday
    }
    return 0;
  }
  function statesAt(m) {
    const s = new Uint8Array(N);
    for (let i = 0; i < N; i++) s[i] = stateAt(i, m);
    return s;
  }

  // ------------------------------------------------------------------ DBSCAN (grid index; same definition as scikit-learn)
  function dbscan(idx, eps, minPts) {
    const n = idx.length, L = new Int32Array(n).fill(-2), e2 = eps * eps;          // -2 unvisited, -1 noise
    const grid = new Map(), key = (gx, gy) => gx * 100003 + gy;
    for (let a = 0; a < n; a++) {
      const k = key(Math.floor(X[idx[a]] / eps), Math.floor(Y[idx[a]] / eps));
      (grid.get(k) || grid.set(k, []).get(k)).push(a);
    }
    const nb = (a) => {
      const x = X[idx[a]], y = Y[idx[a]], gx = Math.floor(x / eps), gy = Math.floor(y / eps), out = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(key(gx + dx, gy + dy)); if (!cell) continue;
        for (const b of cell) { const ex = X[idx[b]] - x, ey = Y[idx[b]] - y; if (ex * ex + ey * ey <= e2) out.push(b); }
      }
      return out;
    };
    let c = 0;
    for (let a = 0; a < n; a++) {
      if (L[a] !== -2) continue;
      const N0 = nb(a);
      if (N0.length < minPts) { L[a] = -1; continue; }
      L[a] = c;
      const q = N0.slice();
      for (let h = 0; h < q.length; h++) {
        const b = q[h];
        if (L[b] === -1) L[b] = c;
        if (L[b] !== -2) continue;
        L[b] = c;
        const Nb = nb(b);
        if (Nb.length >= minPts) for (const z of Nb) if (L[z] < 0) q.push(z);
      }
      c++;
    }
    return { L, k: c };
  }
  function cluster(m, eps = state.eps, minPts = state.minPts, mode = state.mode, s = null) {
    s = s || statesAt(m);
    const idx = [];
    for (let i = 0; i < N; i++) if (mode === "all" || s[i] === 1) idx.push(i);
    const r = dbscan(idx, eps, minPts);
    const lab = new Int32Array(N).fill(-3);                                       // -3 not part of the run
    idx.forEach((i, a) => { lab[i] = r.L[a]; });
    return { lab, k: r.k, s, nIn: idx.length };
  }

  // ------------------------------------------------------------------ geometry helpers
  function hull(pts) {                                                           // monotone chain, pts [[lon,lat]]
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function padRing(ring, metres) {                                               // push hull points outwards from the centroid
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const kx = metres / (Math.cos(cy * Math.PI / 180) * 111320), ky = metres / 110574;
    return ring.map(([x, y]) => { const dx = (x - cx) / kx, dy = (y - cy) / ky, d = Math.hypot(dx, dy) || 1; return [x + dx / d * kx, y + dy / d * ky]; });
  }

  // ------------------------------------------------------------------ run for the selected time
  function nameOf(members) {
    const cnt = {};
    for (const i of members) { const o = C.features[i].properties.ot; if (o) cnt[o] = (cnt[o] || 0) + 1; }
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    if (!top.length) return null;
    return top.length > 1 && top[1][1] >= 0.3 * members.length ? `${top[0][0]} / ${top[1][0]}` : top[0][0];
  }
  function run(keepColors = true) {
    const m = state.day * 1440 + state.min;
    const r = cluster(m);
    lab = r.lab; st = r.s;
    // members per cluster, sorted by size
    const mem = Array.from({ length: r.k }, () => []);
    for (let i = 0; i < N; i++) if (lab[i] >= 0) mem[lab[i]].push(i);
    const order = mem.map((x, k) => k).sort((a, b) => mem[b].length - mem[a].length);
    // colour continuity: inherit the colour most members had a moment ago
    const col = new Int16Array(r.k).fill(-1), used = new Map();
    for (const k of order) {
      if (keepColors && prevColor) {
        const v = {};
        for (const i of mem[k]) { const c = prevColor[i]; if (c >= 0) v[c] = (v[c] || 0) + 1; }
        const best = Object.entries(v).sort((a, b) => b[1] - a[1]).find(([c]) => !used.has(+c));
        if (best && best[1] >= 0.25 * mem[k].length) { col[k] = +best[0]; used.set(+best[0], k); continue; }
      }
    }
    for (const k of order) {
      if (col[k] >= 0) continue;
      let c = 0; const busy = new Set(used.keys());
      while (busy.has(c) && c < PAL.length * 4) c++;
      col[k] = c; used.set(c, k);
    }
    colorOf = new Int16Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (lab[i] >= 0) colorOf[i] = col[lab[i]];
    prevColor = colorOf;

    clusters = order.map((k) => {
      const ids = mem[k], pts = ids.map((i) => C.features[i].geometry.coordinates);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return { k, n: ids.length, ids, c: PAL[col[k] % PAL.length], name: nameOf(ids), ctr: [cx, cy], hull: hull(pts) };
    });
    clusters.forEach((c, r) => { c.rank = r + 1; if (!c.name) c.name = "Cluster " + (r + 1); });

    // feature properties for styling
    for (let i = 0; i < N; i++) {
      const p = C.features[i].properties;
      p.s = st[i];
      p.cl = lab[i] >= 0 ? 1 : 0;
      p.col = lab[i] >= 0 ? PAL[colorOf[i] % PAL.length] : (lab[i] === -1 ? S_OPEN_NOISE : (st[i] === 2 ? S_UNK : S_CLOSED));
      p.in = lab[i] >= -1 ? 1 : 0;
    }
    if (map && map.getSource("cafes")) {
      map.getSource("cafes").setData(C);
      map.getSource("hulls").setData(hullFC());
      map.getSource("labels").setData(labelFC());
    }
    render();
  }
  function hullFC() {
    return { type: "FeatureCollection", features: clusters.filter((c) => c.hull.length >= 3).map((c) => {
      const ring = padRing(c.hull, 45);
      return { type: "Feature", id: c.rank, properties: { r: c.rank, n: c.n, col: c.c, name: c.name },
               geometry: { type: "Polygon", coordinates: [ring.concat([ring[0]])] } };
    }) };
  }
  function labelFC() {
    return { type: "FeatureCollection", features: clusters.slice(0, 14).map((c) => ({ type: "Feature",
      properties: { t: `${c.name.split(" / ")[0]} · ${c.n}`, col: c.c, r: c.rank }, geometry: { type: "Point", coordinates: c.ctr } })) };
  }

  // ------------------------------------------------------------------ map
  function initMap(berlin, bezirke) {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    map = new maplibregl.Map({
      container: "map", hash: true, attributionControl: false,
      center: [13.405, 52.505], zoom: 10.6, minZoom: 9, maxZoom: 18,
      style: `https://basemaps.cartocdn.com/gl/${dark ? "dark-matter" : "positron"}-gl-style/style.json`
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Cafés © OpenStreetMap contributors (ODbL) · Ortsteile © Geoportal Berlin" }));
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", offset: 10 });
    let ready = false;
    const setup = () => {
      if (ready || !map.isStyleLoaded()) return;
      ready = true;
      const first = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      if (bezirke) {
        map.addSource("bz", { type: "geojson", data: bezirke });
        map.addLayer({ id: "bz", type: "line", source: "bz", paint: { "line-color": dark ? "#5a554c" : "#b8afa2", "line-width": 0.8, "line-dasharray": [3, 2] } }, first);
      }
      if (berlin) {
        map.addSource("berlin", { type: "geojson", data: berlin });
        map.addLayer({ id: "berlin", type: "line", source: "berlin", paint: { "line-color": dark ? "#8a8378" : "#857c70", "line-width": 1.6 } }, first);
      }
      map.addSource("hulls", { type: "geojson", data: hullFC() });
      map.addLayer({ id: "hf", type: "fill", source: "hulls", paint: { "fill-color": ["get", "col"], "fill-opacity": ["case", ["boolean", ["feature-state", "hl"], false], 0.32, 0.14] } });
      map.addLayer({ id: "hl", type: "line", source: "hulls", paint: { "line-color": ["get", "col"], "line-width": ["case", ["boolean", ["feature-state", "hl"], false], 2.6, 1.3], "line-opacity": 0.9 } });
      map.addSource("cafes", { type: "geojson", data: C });
      const r = (a, b) => ["interpolate", ["linear"], ["zoom"], 10, a, 15, b];
      map.addLayer({ id: "c-off", type: "circle", source: "cafes", filter: ["==", ["get", "in"], 0],
        paint: { "circle-radius": r(1.4, 4), "circle-color": ["case", ["==", ["get", "s"], 2], "rgba(0,0,0,0)", S_CLOSED],
                 "circle-stroke-color": S_UNK, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "s"], 2], 0.7, 0], 15, ["case", ["==", ["get", "s"], 2], 1.4, 0]], "circle-opacity": 0.75, "circle-stroke-opacity": 0.8 } });
      map.addLayer({ id: "c-noise", type: "circle", source: "cafes", filter: ["all", ["==", ["get", "in"], 1], ["==", ["get", "cl"], 0]],
        paint: { "circle-radius": r(2, 5), "circle-color": S_OPEN_NOISE, "circle-stroke-color": dark ? "#1b1a17" : "#fff", "circle-stroke-width": r(0.4, 1) } });
      map.addLayer({ id: "c-cl", type: "circle", source: "cafes", filter: ["==", ["get", "cl"], 1],
        paint: { "circle-radius": r(2.6, 6.5), "circle-color": ["get", "col"], "circle-stroke-color": dark ? "#1b1a17" : "#fff", "circle-stroke-width": r(0.5, 1.4) } });
      map.addSource("labels", { type: "geojson", data: labelFC() });
      map.addLayer({ id: "lab", type: "symbol", source: "labels", minzoom: 10.8,
        layout: { "text-field": ["get", "t"], "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10.5, 14, 13],
                  "text-offset": [0, -1.4], "symbol-sort-key": ["get", "r"], "text-allow-overlap": false, "text-padding": 4 },
        paint: { "text-color": ["get", "col"], "text-halo-color": dark ? "#141311" : "#fff", "text-halo-width": 1.8 } });
      applyHulls();

      // hover + click
      const tip = $("#tip");
      let hlId = null;
      const setHL = (id) => { if (hlId != null) map.setFeatureState({ source: "hulls", id: hlId }, { hl: false }); hlId = id; if (id != null) map.setFeatureState({ source: "hulls", id }, { hl: true }); };
      const cafeLayers = ["c-cl", "c-noise", "c-off"];
      map.on("mousemove", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: cafeLayers })[0];
        const h = state.hulls ? map.queryRenderedFeatures(e.point, { layers: ["hf"] })[0] : null;
        map.getCanvas().style.cursor = f || h ? "pointer" : "";
        setHL(h ? h.id : (state.sel ? state.sel : null));
        if (f) {
          const p = f.properties;
          tip.innerHTML = `<span class="dot" style="background:${p.col}"></span><b>${esc(p.n || "Unnamed café")}</b><small>${stLabel(+p.s)}${p.cl == 1 ? " · in a cluster" : ""}</small>`;
        } else if (h) {
          tip.innerHTML = `<span class="dot" style="background:${h.properties.col}"></span><b>${esc(h.properties.name)}</b><small>${h.properties.n} cafés ${state.mode === "open" ? "open" : ""} · click for the list</small>`;
        }
        tip.hidden = !(f || h);
        if (!tip.hidden) { tip.style.left = e.point.x + "px"; tip.style.top = e.point.y + "px"; }
      });
      map.on("mouseout", () => { tip.hidden = true; });
      map.on("click", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: cafeLayers })[0];
        if (f) { cafePopup(+f.properties.i, e.lngLat); return; }
        const h = state.hulls ? map.queryRenderedFeatures(e.point, { layers: ["hf"] })[0] : null;
        if (h) selectCluster(h.properties.r, false); else { popup.remove(); }
      });
      $("#loading").classList.add("done");
      try { if (!localStorage.getItem("d4intro")) $("#intro").hidden = false; } catch (e) { $("#intro").hidden = false; }
    };
    map.on("load", setup);
    map.on("styledata", () => setTimeout(setup, 0));
    const poll = setInterval(() => { setup(); if (ready) clearInterval(poll); }, 400);
    window._map = map;
  }
  function applyHulls() {
    if (!map || !map.getLayer("hf")) return;
    for (const id of ["hf", "hl", "lab"]) map.setLayoutProperty(id, "visibility", state.hulls ? "visible" : "none");
  }
  const stLabel = (s) => s === 1 ? "open" : s === 2 ? "opening hours unknown" : "closed";

  function cafePopup(i, ll) {
    const f = C.features[i], p = f.properties, m = state.day * 1440 + state.min, s = st[i];
    let next = "";
    if (OH[i]) {
      try {
        const it = OH[i].getIterator(refDate(m)), ch = it.advance();
        if (ch && s !== 2) {
          const dm = Math.round((ch - refDate(m)) / 60000);
          const when = dm < 1440 ? `${DAYS[(new Date(ch).getDay() + 6) % 7] === DAYS[state.day] ? "" : DAYS[(new Date(ch).getDay() + 6) % 7].slice(0, 3) + " "}${hhmm(new Date(ch).getHours() * 60 + new Date(ch).getMinutes())}` : DAYS[(new Date(ch).getDay() + 6) % 7].slice(0, 3) + " " + hhmm(new Date(ch).getHours() * 60 + new Date(ch).getMinutes());
          next = s === 1 ? `open until ${when}` : `opens ${when}`;
        }
      } catch (e) { /* ignore */ }
    }
    const c = lab[i] >= 0 ? clusters.find((x) => x.k === lab[i]) : null;
    const tag = s === 1 ? `<span class="tag" style="background:#2b8a3e">Open</span>` : s === 2 ? `<span class="tag" style="background:${S_UNK}">Unknown</span>` : `<span class="tag" style="background:#868e96">Closed</span>`;
    const q = { ok: "", warn: " <small>(tag has a syntax warning)</small>", error: " <small>(tag could not be parsed)</small>", missing: "" }[p.q] || "";
    popup.setLngLat(ll).setHTML(`<div class="pop"><b>${esc(p.n || "Unnamed café")}</b>
      <small>${esc([p.a, p.ot].filter(Boolean).join(" · "))}</small>
      <div>${tag} <span class="mono" style="font-size:12px">${DAYS[state.day].slice(0, 3)} ${hhmm(state.min)}</span> ${next ? `<small style="display:inline">· ${next}</small>` : ""}</div>
      ${p.oh ? `<div class="ohtxt mono">${esc(p.oh)}</div>${q}` : `<small>No opening_hours in OSM yet.</small>`}
      ${c ? `<div style="margin-top:6px"><span class="dot" style="background:${c.c}"></span> ${esc(c.name)} cluster · ${c.n} cafés</div>` : (lab[i] === -1 ? `<small style="margin-top:6px">Open, but no cluster nearby (noise)</small>` : "")}
      ${p.ck ? `<small>hours last checked in OSM: ${p.ck}</small>` : ""}
      <small><a href="https://www.openstreetmap.org/${esc(p.id)}" target="_blank" rel="noopener">${esc(p.id)} on OpenStreetMap ↗</a></small></div>`).addTo(map);
  }

  function selectCluster(rank, fly = true) {
    const c = clusters.find((x) => x.rank === rank);
    if (!c) return;
    state.sel = rank;
    if (map.getSource("hulls")) { map.removeFeatureState({ source: "hulls" }); map.setFeatureState({ source: "hulls", id: rank }, { hl: true }); }
    if (fly) {
      const xs = c.ids.map((i) => C.features[i].geometry.coordinates);
      const b = xs.reduce((a, p) => [[Math.min(a[0][0], p[0]), Math.min(a[0][1], p[1])], [Math.max(a[1][0], p[0]), Math.max(a[1][1], p[1])]], [[180, 90], [-180, -90]]);
      map.fitBounds(b, { padding: { top: 80, bottom: 90, left: innerWidth > 860 ? 420 : 40, right: 60 }, maxZoom: 15.5, duration: 800 });
    }
    const m = state.day * 1440 + state.min;
    const rows = c.ids.map((i) => C.features[i].properties).sort((a, b) => (a.n || "~").localeCompare(b.n || "~"));
    const d = $("#detail");
    d.hidden = false;
    d.innerHTML = `<button class="close" aria-label="Close">×</button>
      <p class="eyebrow" style="color:${c.c}">Cluster ${c.rank} of ${clusters.length} · ${DAYS[state.day]} ${hhmm(state.min)}</p>
      <h3>${esc(c.name)}</h3>
      <div class="kpis"><div class="kpi"><b>${c.n}</b><span>cafés ${state.mode === "open" ? "open" : "in cluster"}</span></div>
        <div class="kpi"><b>${fmt(100 * c.n / Math.max(1, lab.filter((x) => x >= -1).length), 1)} %</b><span>of all ${state.mode === "open" ? "open " : ""}cafés</span></div>
        <div class="kpi"><b>${fmt(areaKm2(c.hull), 2)}</b><span>km² outline</span></div></div>
      <ul class="clist">${rows.map((p) => `<li data-i="${p.i}"><b>${esc(p.n || "Unnamed café")}</b><small>${esc(p.a || "")}</small></li>`).join("")}</ul>`;
    d.querySelector(".close").onclick = () => { d.hidden = true; state.sel = null; map.removeFeatureState({ source: "hulls" }); };
    d.querySelectorAll("li[data-i]").forEach((li) => li.onclick = () => {
      const i = +li.dataset.i, ll = C.features[i].geometry.coordinates;
      map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 15.5) });
      cafePopup(i, { lng: ll[0], lat: ll[1] });
    });
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
    void m;
  }
  function areaKm2(ring) {
    if (ring.length < 3) return 0;
    const k = Math.cos(52.52 * Math.PI / 180) * 111.32, l = 110.574;
    let a = 0;
    for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * k * y2 * l - x2 * k * y1 * l; }
    return Math.abs(a) / 2;
  }

  // ------------------------------------------------------------------ panel
  let WS = null;            // week series for the current settings
  function weekSeries() {
    const out = [];
    for (let t = 0; t < 168; t++) {
      const m = t * 60 + 30, s = statesAt(m);
      let o = 0, u = 0; for (let i = 0; i < N; i++) { if (s[i] === 1) o++; else if (s[i] === 2) u++; }
      const r = cluster(m, state.eps, state.minPts, "open", s);
      out.push({ t, o, u, k: r.k });
    }
    return out;
  }
  function initPanel() {
    $("#osmDate").textContent = $("#osmDate2").textContent = new Date(S.osm_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const q = S.oh_status;
    $("#dq").innerHTML = `${fmt(S.n)} cafés; <b>${fmt(S.with_oh)}</b> (${fmt(100 * S.with_oh / S.n, 1)} %) have an <code>opening_hours</code> tag, <b>${fmt(q.missing || 0)}</b> do not. `
      + `opening_hours.js parses ${fmt((q.ok || 0) + (q.warn || 0))} tags (${fmt(q.warn || 0)} with a syntax warning) and fails on ${fmt(q.error || 0)}; those stay <i>unknown</i>. `
      + `Cafés without hours are shown as grey rings and are never clustered, so the open-café clusters are a lower bound.`;
    $("#downloads").innerHTML = `<span>Download (ODbL):</span><a href="data/berlin_cafes_clusters.gpkg.zip">GeoPackage</a><a href="data/berlin_cafes_clusters.csv.zip">CSV</a><a href="data/stats.json">stats.json</a>`;

    const t = new URLSearchParams(location.search);
    if (t.has("d")) state.day = Math.min(6, Math.max(0, +t.get("d")));
    if (t.has("t")) state.min = Math.min(1425, Math.max(0, Math.round(+t.get("t") / 15) * 15));

    $$("#daySeg button").forEach((b) => b.onclick = () => { stop(); state.day = +b.dataset.d; update(); });
    $("#time").oninput = (e) => { stop(); state.min = +e.target.value; update(); };
    $$("#moments button").forEach((b) => b.onclick = () => { stop(); const [d, m] = b.dataset.m.split(",").map(Number); state.day = d; state.min = m; update(); });
    $$("#modeSeg button").forEach((b) => b.onclick = () => { state.mode = b.dataset.mode; update(false); });
    $$("#epsSeg button").forEach((b) => b.onclick = () => { state.eps = +b.dataset.e; WS = null; update(false); });
    $$("#minSeg button").forEach((b) => b.onclick = () => { state.minPts = +b.dataset.n; WS = null; update(false); });
    $("#hullsT").onchange = (e) => { state.hulls = e.target.checked; applyHulls(); };
    $("#playBtn").onclick = () => playing ? stop() : play();
    $("#nowBtn").onclick = () => {
      stop();
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      const g = (k) => p.find((x) => x.type === k).value;
      state.day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday"));
      state.min = Math.floor((+g("hour") * 60 + +g("minute")) / 15) * 15;
      update();
    };
    $("#introGo").onclick = () => { $("#intro").hidden = true; try { localStorage.setItem("d4intro", "1"); } catch (e) { /* ignore */ } };
    $("#week").onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 330;
      const h = Math.max(0, Math.min(167, Math.floor((x - 30) / (290 / 168))));
      stop(); state.day = Math.floor(h / 24); state.min = (h % 24) * 60 + 30; update();
    };
    update(false);
  }
  function update(keep = true) {
    if (state.min > 1425) state.min = 1425;
    run(keep);
  }
  function play() {
    $("#playBtn").classList.add("on"); $("#playBtn").textContent = "❚❚ Pause";
    playing = setInterval(() => {
      state.min += 30;
      if (state.min >= 1440) { state.min = 0; state.day = (state.day + 1) % 7; }
      update();
    }, 650);
  }
  function stop() {
    if (!playing) return;
    clearInterval(playing); playing = null;
    $("#playBtn").classList.remove("on"); $("#playBtn").textContent = "▶ Play the week";
  }

  function render() {
    const d = state.day, m = state.min;
    $$("#daySeg button").forEach((b) => b.classList.toggle("on", +b.dataset.d === d));
    $("#time").value = m; $("#timeO").textContent = hhmm(m);
    $("#clockDay").textContent = DAYS[d].slice(0, 3); $("#clockTime").textContent = hhmm(m);
    $$("#moments button").forEach((b) => b.classList.toggle("on", b.dataset.m === `${d},${m}`));
    $$("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
    $$("#epsSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.e === state.eps));
    $$("#minSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.n === state.minPts));
    try { history.replaceState(null, "", `?d=${d}&t=${m}${location.hash}`); } catch (e) { /* ignore */ }

    let o = 0, c = 0, u = 0;
    for (let i = 0; i < N; i++) { if (st[i] === 1) o++; else if (st[i] === 2) u++; else c++; }
    const inRun = state.mode === "open" ? o : N, cl = clusters.reduce((a, x) => a + x.n, 0);
    $("#kpis").innerHTML = `<div class="kpi"><b>${fmt(o)}</b><span>open now</span></div>
      <div class="kpi"><b>${fmt(clusters.length)}</b><span>cluster${clusters.length === 1 ? "" : "s"}</span></div>
      <div class="kpi"><b>${fmt(inRun ? 100 * cl / inRun : 0)} %</b><span>${state.mode === "open" ? "of open cafés" : "of cafés"} in a cluster</span></div>
      <div class="kpi"><b>${fmt(clusters[0]?.n || 0)}</b><span>largest cluster</span></div>`;
    $("#ocu").innerHTML = `<i style="flex:${o};background:#2b8a3e"></i><i style="flex:${c};background:${S_CLOSED}"></i><i style="flex:${u};background:repeating-linear-gradient(45deg,${S_UNK} 0 3px,transparent 3px 6px)"></i>`;
    $("#lede").innerHTML = state.mode === "open"
      ? `<b>${DAYS[d]}, ${hhmm(m)}:</b> ${fmt(o)} of ${fmt(N)} cafés are open according to OpenStreetMap, in <b>${clusters.length} cluster${clusters.length === 1 ? "" : "s"}</b>. The biggest is around <b>${esc(clusters[0]?.name || "–")}</b> with ${fmt(clusters[0]?.n || 0)} cafés.`
      : `<b>All ${fmt(N)} cafés</b>, regardless of opening hours, form <b>${clusters.length} clusters</b> with ${state.eps} m / ${state.minPts}. Switch to “Open at this time” to see how they change over the week.`;

    // cluster list
    $("#clist").innerHTML = clusters.slice(0, 10).map((x) => `<li data-r="${x.rank}"><span class="n">${x.rank}</span><span>${esc(x.name)}</span>
      <span class="bar" style="background:${x.c};width:${Math.max(6, 64 * x.n / (clusters[0]?.n || 1))}px"></span><span class="v">${x.n}</span></li>`).join("")
      + (clusters.length > 10 ? `<li class="more"><span></span><span>+ ${clusters.length - 10} smaller clusters</span></li>` : "")
      + (!clusters.length ? `<li class="more"><span></span><span>No cluster at this time — too few cafés open close together.</span></li>` : "");
    $$("#clist li[data-r]").forEach((li) => li.onclick = () => selectCluster(+li.dataset.r));
    if (state.sel && !$("#detail").hidden) { const sc = clusters.find((x) => x.rank === state.sel); if (!sc) { $("#detail").hidden = true; state.sel = null; } }

    sensTable(d * 1440 + m);
    weekChart();
    legend(o, c, u);
  }

  function sensTable(m) {
    const s = st, E = [150, 250, 350], M = [3, 5, 8];
    let h = `<tr><th>clusters</th>${M.map((x) => `<th>min ${x}</th>`).join("")}</tr>`;
    for (const e of E) {
      h += `<tr><th>${e} m</th>` + M.map((n) => {
        const r = cluster(m, e, n, state.mode, s), share = r.nIn ? Math.round(100 * Array.from(r.lab).filter((x) => x >= 0).length / r.nIn) : 0;
        const on = e === state.eps && n === state.minPts;
        return `<td class="${on ? "on" : ""}" data-e="${e}" data-n="${n}"><b>${r.k}</b><small>${share} %</small></td>`;
      }).join("") + "</tr>";
    }
    $("#sens").innerHTML = h + `<tr><td colspan="4" class="cap">clusters · share of ${state.mode === "open" ? "open " : ""}cafés clustered, at the selected time</td></tr>`;
    $$("#sens td[data-e]").forEach((td) => td.onclick = () => { state.eps = +td.dataset.e; state.minPts = +td.dataset.n; WS = null; update(false); });
  }

  function weekChart() {
    if (!WS) WS = weekSeries();
    const W = 330, H = 150, x0 = 30, x1 = 320, y0 = 12, y1 = 118, dx = (x1 - x0) / 168;
    const maxO = Math.max(...WS.map((w) => w.o)) || 1, maxK = Math.max(...WS.map((w) => w.k)) || 1;
    const yo = (v) => y1 - (y1 - y0) * v / (maxO * 1.05), yk = (v) => y1 - (y1 - y0) * v / (maxK * 1.15);
    let g = "";
    for (let d = 0; d < 7; d++) {
      const xa = x0 + d * 24 * dx;
      if (d % 2 === 1) g += `<rect x="${xa}" y="${y0}" width="${24 * dx}" height="${y1 - y0}" fill="var(--chip)"/>`;
      g += `<text x="${xa + 12 * dx}" y="${y1 + 13}" text-anchor="middle">${DAYS[d].slice(0, 2)}</text>`;
    }
    g += `<path d="M${x0},${y1} ${WS.map((w) => `L${x0 + (w.t + 0.5) * dx},${yo(w.o)}`).join(" ")} L${x1},${y1}Z" fill="var(--accent)" opacity=".18"/>`;
    g += `<path d="${WS.map((w, i) => `${i ? "L" : "M"}${x0 + (w.t + 0.5) * dx},${yo(w.o)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
    g += `<path d="${WS.map((w, i) => `${i ? "L" : "M"}${x0 + (w.t + 0.5) * dx},${yk(w.k)}`).join(" ")}" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`;
    g += `<text x="${x0 - 4}" y="${yo(maxO) + 3}" text-anchor="end" fill="var(--accent)">${fmt(maxO)}</text><text x="${x0 - 4}" y="${y1}" text-anchor="end">0</text>`;
    g += `<text x="${x1}" y="${y0 - 2}" text-anchor="end">max ${maxK} clusters</text>`;
    const cx = x0 + (state.day * 24 + state.min / 60) * dx;
    g += `<line x1="${cx}" x2="${cx}" y1="${y0 - 4}" y2="${y1}" stroke="var(--ink)" stroke-width="1.4"/><circle cx="${cx}" cy="${y0 - 4}" r="3" fill="var(--ink)"/>`;
    g += `<text x="${x0}" y="${H - 4}">hourly, ${state.eps} m / min ${state.minPts}, open cafés only</text>`;
    $("#week").innerHTML = g;
  }

  function legend(o, c, u) {
    const L = $("#legend");
    const open = state.mode === "open";
    L.innerHTML = `<div class="lg-title">${open ? "Cafés open on " + DAYS[state.day] + " at " + hhmm(state.min) : "All cafés"}</div>
      <div class="lg-sub">DBSCAN · ${state.eps} m · at least ${state.minPts} cafés</div>
      <div class="lg-row"><i style="background:conic-gradient(${PAL.slice(0, 6).join(",")})"></i>in a cluster <small>${fmt(clusters.reduce((a, x) => a + x.n, 0))}</small></div>
      <div class="lg-row"><i style="background:${S_OPEN_NOISE};transform:scale(.8)"></i>${open ? "open, " : ""}no cluster nearby <small>${fmt(lab.filter((x) => x === -1).length)}</small></div>
      ${open ? `<div class="lg-row"><i style="background:${S_CLOSED};transform:scale(.6)"></i>closed <small>${fmt(c)}</small></div>
      <div class="lg-row"><i style="border:1.5px solid ${S_UNK};background:none;transform:scale(.7)"></i>opening hours unknown <small>${fmt(u)}</small></div>` : ""}
      <div class="lg-row"><i class="sq" style="background:${PAL[1]}33;border:1.5px solid ${PAL[1]}"></i>cluster outline <small>click it</small></div>`;
  }
})();
