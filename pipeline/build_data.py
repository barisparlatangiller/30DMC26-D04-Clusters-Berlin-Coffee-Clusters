"""
Where Berlin Brews — data build for the web map.

  1  OSM cafés (Overpass export, amenity=cafe) → one clean record per OSM object
  2  opening_hours validated and evaluated with opening_hours.js (pipeline/eval_hours.mjs)
  3  Berlin boundary + Ortsteile (Geoportal Berlin WFS, dl-de/zero-2-0) to name clusters
  4  DBSCAN: baseline on all cafés, sensitivity grid, and the full week hour by hour
  5  docs/data/*  for the map + downloads

  python pipeline/build_data.py
"""
import json, re, subprocess, zipfile, io, sys, os
from pathlib import Path

import numpy as np
import pandas as pd
import geopandas as gpd
import requests
from sklearn.cluster import DBSCAN

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "berlin_cafes_osm_20261104.gpkg"
OSM_DATE = "2026-11-04T11:50:06Z"            # Overpass export timestamp
BUILD = ROOT / "build"; BUILD.mkdir(exist_ok=True)
OUT = ROOT / "docs" / "data"; OUT.mkdir(parents=True, exist_ok=True)
CRS = 25833

EPS0, MIN0 = 250, 5
EPS_GRID, MIN_GRID = [150, 250, 350], [3, 5, 8]
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
SNAP = {"Mon 08:30": (0, 8), "Mon 12:30": (0, 12), "Fri 20:30": (4, 20), "Sat 23:30": (5, 23), "Sun 11:30": (6, 11)}


def log(*a):
    print(*a, flush=True)


def wfs_layer(service):
    """first feature type of a Geoportal Berlin WFS, as GeoDataFrame in EPSG:25833 (None if unreachable)"""
    base = f"https://gdi.berlin.de/services/wfs/{service}"
    try:
        cap = requests.get(base, params={"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"}, timeout=60).text
        name = re.search(r"<(?:wfs:)?FeatureType[^>]*>\s*<(?:wfs:)?Name>([^<]+)</", cap).group(1)
        r = requests.get(base, params={"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": name,
                                       "outputFormat": "application/json", "srsName": "EPSG:25833"}, timeout=120)
        r.raise_for_status()
        g = gpd.read_file(io.BytesIO(r.content))
        if g.crs is None:
            g = g.set_crs(CRS)
        log(f"WFS {service}: {name} · {len(g)} features · {list(g.columns)[:8]}")
        return g.to_crs(CRS)
    except Exception as e:                                               # noqa: BLE001
        log(f"WFS {service} not available: {e}")
        return None


def pick(g, *cands):
    for c in cands:
        for col in g.columns:
            if col.lower() == c:
                return col
    return None


def dbscan(xy, eps, m):
    if len(xy) == 0:
        return np.array([], dtype=int)
    return DBSCAN(eps=eps, min_samples=m).fit(xy).labels_


def summary(lab):
    k = lab[lab >= 0]
    sizes = np.bincount(k) if len(k) else np.array([], dtype=int)
    return {"clusters": int(len(sizes)), "clustered": int(len(k)), "noise": int((lab < 0).sum()),
            "largest": int(sizes.max()) if len(sizes) else 0,
            "share_clustered": round(100 * len(k) / len(lab), 1) if len(lab) else 0.0}


def main():
    # 1 — cafés
    g = gpd.read_file(SRC).to_crs(CRS)
    g = g.drop_duplicates("@id").reset_index(drop=True)
    g["oh"] = pd.Series([s.strip() if isinstance(s, str) and s.strip() else None for s in g["opening_hours"]], dtype=object)
    addr = (g["addr:street"].fillna("") + " " + g["addr:housenumber"].fillna("")).str.strip()
    addr = np.where(g["addr:postcode"].notna(), addr + ", " + g["addr:postcode"].fillna(""), addr)
    g["addr"] = pd.Series(addr).str.strip(", ").replace("", None)
    log(f"Cafés: {len(g):,} · with opening_hours: {g.oh.notna().sum():,} · named: {g.name.notna().sum():,}")

    # 2 — opening_hours.js
    mini = [{"id": i, "oh": o} for i, o in zip(g["@id"], g["oh"])]
    (BUILD / "cafes_min.json").write_text(json.dumps(mini))
    env = dict(os.environ, TZ="Europe/Berlin")
    res = subprocess.run(["node", str(ROOT / "pipeline" / "eval_hours.mjs"), str(BUILD / "cafes_min.json"),
                          str(BUILD / "hours_eval.json")], env=env, capture_output=True, text=True)
    log(res.stdout, res.stderr)
    res.check_returncode()
    ev = {e["id"]: e for e in json.loads((BUILD / "hours_eval.json").read_text())}
    g["q"] = g["@id"].map(lambda i: ev[i]["status"])
    week = np.array([list(ev[i].get("week", "u" * 168)) for i in g["@id"]])          # (n, 168) o/c/u
    q = g.q.value_counts().to_dict()
    log("opening_hours status:", q)
    warn_examples = {}
    for e in ev.values():
        for w in e.get("warnings", [])[:1]:
            key = re.sub(r'"[^"]*"', '"…"', w)[:90]
            warn_examples[key] = warn_examples.get(key, 0) + 1
    errors = [{"oh": g.loc[g["@id"] == e["id"], "oh"].iat[0], "error": e["error"][:120]} for e in ev.values() if e["status"] == "error"]

    # 3 — boundary, Ortsteile, Bezirke
    ot = wfs_layer("alkis_ortsteile")
    bz = wfs_layer("alkis_bezirke")
    g["ot"], g["bz"] = None, None
    layers = {}
    if ot is not None:
        c = pick(ot, "nam", "name", "ortsteilname", "ortsteil")
        j = gpd.sjoin(g[["geometry"]], ot[[c, "geometry"]], how="left", predicate="within")
        g["ot"] = j[~j.index.duplicated()][c].values
        layers["ortsteile"] = ot[[c, "geometry"]].rename(columns={c: "n"})
    if bz is not None:
        c = pick(bz, "nam", "name", "bezirksname", "bezirk")
        j = gpd.sjoin(g[["geometry"]], bz[[c, "geometry"]], how="left", predicate="within")
        g["bz"] = j[~j.index.duplicated()][c].values
        layers["bezirke"] = bz[[c, "geometry"]].rename(columns={c: "n"})
        layers["berlin"] = gpd.GeoDataFrame(geometry=[bz.union_all()], crs=CRS)
    for k, v in layers.items():
        v = v.copy(); v["geometry"] = v.geometry.simplify(15 if k == "ortsteile" else 25)
        v.to_crs(4326).to_file(OUT / f"{k}.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    inside = int(g.bz.notna().sum()) if bz is not None else None

    # 4 — DBSCAN
    xy = np.c_[g.geometry.x, g.geometry.y]
    lab0 = dbscan(xy, EPS0, MIN0)
    g["c0"] = lab0
    base = summary(lab0)
    names = {}
    for k in range(base["clusters"]):
        m = g[g.c0 == k]
        top = m.ot.dropna().value_counts()
        names[k] = {"n": int(len(m)), "ot": " / ".join(top.index[:2]) if len(top) else None,
                    "share_known": round(100 * (m.q.isin(["ok", "warn"])).mean(), 1)}
    big = sorted(names.items(), key=lambda kv: -kv[1]["n"])[:10]
    log("Baseline DBSCAN (all cafés):", base)
    for k, v in big:
        log(f"  cluster {k}: {v}")

    sens = {"all": {}, **{s: {} for s in SNAP}}
    for e in EPS_GRID:
        for m in MIN_GRID:
            sens["all"][f"{e}_{m}"] = summary(dbscan(xy, e, m))
            for s, (d, h) in SNAP.items():
                o = week[:, d * 24 + h] == "o"
                sens[s][f"{e}_{m}"] = {**summary(dbscan(xy[o], e, m)), "open": int(o.sum())}

    series = []
    for t in range(168):
        col = week[:, t]
        o = col == "o"
        s = summary(dbscan(xy[o], EPS0, MIN0))
        series.append({"t": t, "d": DAYS[t // 24], "h": t % 24, "open": int(o.sum()),
                       "closed": int((col == "c").sum()), "unknown": int((col == "u").sum()), **s})
    sr = pd.DataFrame(series)
    peak = sr.loc[sr.open.idxmax()]
    log("Peak open:", peak.to_dict())
    log(sr.groupby("d", sort=False)[["open", "clusters"]].max())

    # who appears / disappears: Ortsteile with most clustered open cafés by time of day
    slots = {"morning 08:30": 8, "noon 12:30": 12, "evening 19:30": 19, "night 23:30": 23}
    tod = {}
    for lbl, h in slots.items():
        per = {}
        for d in range(7):
            o = week[:, d * 24 + h] == "o"
            lab = dbscan(xy[o], EPS0, MIN0)
            sub = g[o].assign(l=lab)
            cl = sub[sub.l >= 0]
            for k, v in cl.ot.dropna().value_counts().items():
                per[k] = per.get(k, 0) + v
        tod[lbl] = [{"ot": k, "avg_clustered": round(v / 7, 1)} for k, v in sorted(per.items(), key=lambda kv: -kv[1])[:6]]

    # 5 — outputs
    keep = g.to_crs(4326)
    feats = []
    for i, r in keep.iterrows():
        p = {"id": r["@id"], "q": r.q, "x": round(float(xy[i, 0]), 1), "y": round(float(xy[i, 1]), 1)}
        if isinstance(r["name"], str): p["n"] = r["name"]
        if r.oh: p["oh"] = r.oh
        if isinstance(r.addr, str): p["a"] = r.addr
        if isinstance(r.ot, str): p["ot"] = r.ot
        if isinstance(r.bz, str): p["bz"] = r.bz
        ck = r.get("check_date:opening_hours")
        if pd.notna(ck): p["ck"] = str(ck)[:10]
        feats.append({"type": "Feature", "properties": p,
                      "geometry": {"type": "Point", "coordinates": [round(r.geometry.x, 6), round(r.geometry.y, 6)]}})
    (OUT / "cafes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False,
                                                  separators=(",", ":")))

    tab = g[["@id", "name", "oh", "q", "addr", "ot", "bz", "c0"]].rename(columns={
        "@id": "osm_id", "oh": "opening_hours", "q": "oh_status", "ot": "ortsteil", "bz": "bezirk", "c0": "dbscan_all_250m_5"})
    tab["x_25833"], tab["y_25833"] = g.geometry.x.round(1), g.geometry.y.round(1)
    tab.insert(9, "week_open_hours_ref", (week == "o").sum(1))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("berlin_cafes_clusters.csv", tab.to_csv(index=False))
        z.writestr("LICENSE.txt", "Contains information from OpenStreetMap, © OpenStreetMap contributors, "
                   "available under the Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/\n"
                   f"OSM data as of {OSM_DATE}. This derived table is also shared under ODbL 1.0.\n")
    (OUT / "berlin_cafes_clusters.csv.zip").write_bytes(buf.getvalue())
    gp = BUILD / "berlin_cafes_clusters.gpkg"
    gpd.GeoDataFrame(tab, geometry=g.geometry.values, crs=CRS).to_file(gp, layer="cafes", driver="GPKG")
    with zipfile.ZipFile(OUT / "berlin_cafes_clusters.gpkg.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.write(gp, "berlin_cafes_clusters.gpkg")
        z.writestr("LICENSE.txt", "© OpenStreetMap contributors, ODbL 1.0 — https://opendatacommons.org/licenses/odbl/1-0/\n")

    stats = {
        "osm_date": OSM_DATE, "n": int(len(g)), "inside_berlin": inside,
        "with_oh": int(g.oh.notna().sum()), "oh_status": {k: int(v) for k, v in q.items()},
        "warn_types": sorted(([k, v] for k, v in warn_examples.items()), key=lambda kv: -kv[1])[:8],
        "errors": errors[:15], "n_errors": len(errors),
        "baseline": {"eps": EPS0, "min": MIN0, **base, "top": [{"k": int(k), **v} for k, v in big]},
        "sensitivity": sens, "series": series,
        "peak": {k: (int(v) if isinstance(v, (int, np.integer)) else (float(v) if isinstance(v, (float, np.floating)) else v)) for k, v in peak.to_dict().items()},
        "time_of_day": tod, "ref_week": "2026-11-09/2026-11-15",
        "has_ortsteile": ot is not None,
    }
    (OUT / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=1))
    log("done")


if __name__ == "__main__":
    sys.exit(main())
