# Where Berlin Brews — A Week in Coffee Clusters

**#30DayMapChallenge 2026 · Day 4 · Clusters · Berlin**

👉 **Interactive map:** https://barisparlatangiller.github.io/30DMC26-D04-Clusters-Berlin-Coffee-Clusters/

Where do Berlin's cafés cluster, and how do those clusters change over the week? The map takes the 2,619 cafés in
OpenStreetMap, works out which ones are open at the day and time you pick, and runs **DBSCAN** on only those cafés.
Clusters form in the morning, peak around lunch and mostly disappear in the evening.

| Moment (reference week) | open cafés | clusters | largest | share clustered |
|---|---:|---:|---:|---:|
| Mon 08:30 | 689 | 30 | 29 | 38 % |
| Wed 12:30 | 1,540 | 45 | 177 | 60 % |
| Sat 11:30 | 1,326 | 42 | 117 | 56 % |
| Fri 21:30 | 254 | 6 | 8 | 13 % |
| Sat 23:30 | 110 | 1 | 5 | 5 % |
| Sun 03:30 | 17 | 0 | – | 0 % |

*DBSCAN 250 m / 5 cafés, open cafés only, sampled at hh:30. The peak is Friday 14:30, with 1,630 cafés open
according to their tags.*

## What the map does

* **Day and time selector** (Mo–Su, 00:00–23:45 in 15-minute steps), quick “moments”, **Play the week**
  and **Now**.
* **Open at this time / All cafés.** Open cafés are coloured by cluster, open cafés outside any cluster are
  brown (noise), closed cafés are small grey dots and cafés with unknown hours are grey rings.
* **Cluster outlines:** hover or click one to get the number of cafés and the full list.
* **Click a café** to see its name, address, `opening_hours`, its state at the selected time, when it next
  opens or closes, its cluster and a link to OSM.
* **Live counters:** open, clusters, share clustered, largest cluster, and the open / closed / unknown split.
* **DBSCAN settings** (eps 150 / 250 / 350 m × min 3 / 5 / 8) with a **sensitivity table**: all 9
  combinations are computed for the selected time.
* **Week chart:** open cafés and number of clusters for all 168 hours. Click it to jump to that hour.
* Colours **follow a cluster through time**: a cluster takes the colour most of its cafés had a moment
  before. Names come from the Ortsteil that most of its cafés are in.
* The URL keeps the selection (`?d=4&t=870#zoom/lat/lon`), so a view can be shared.

## Method

1. **Data.** Overpass export of all `amenity=cafe` objects in Berlin (4 Nov 2026, 11:50 UTC). Polygons are
   reduced to their centre. The export is in `data/berlin_cafes_osm_20261104.gpkg` (EPSG:25833) with 2,619
   unique OSM IDs.
2. **Opening hours, method B.** No 168 hour columns are created. The single `opening_hours` tag is parsed
   with [opening_hours.js](https://github.com/opening-hours/opening_hours.js), the reference parser of the OSM
   community:
   * in the **browser**, live, for the selected time (`docs/vendor/opening_hours.bundle.js`);
   * in the **pipeline** (`pipeline/eval_hours.mjs`), only for validation and statistics.

   Each café is **open**, **closed** or **unknown**. Unknown covers a missing tag, a tag that cannot be parsed,
   and rules that are themselves “unknown”. It is never counted as closed.
3. **Reference week.** Monday 9 to Sunday 15 November 2026 has no public or school holidays in Berlin, so
   weekday rules apply. Rules for `PH`, `SH` or specific dates in the tag are parsed correctly but have no
   effect in this week.
4. **DBSCAN** (Ester et al. 1996) runs in EPSG:25833 metres. A café is a core point when at least *min*
   cafés, itself included, are within *eps* metres. This is the same definition scikit-learn uses. The
   browser implementation (grid index) was checked against `sklearn.cluster.DBSCAN` and returns the same
   clusters: 46 clusters for all cafés at 250 m / 5, the largest with 493 cafés.
5. **Ortsteile / Bezirke** come from the Geoportal Berlin WFS (ALKIS), are joined to the cafés and are used to
   name the clusters.

### Sensitivity (all cafés)

| eps \ min | 3 | 5 | 8 |
|---|---:|---:|---:|
| 150 m | 172 clusters · 65 % | 90 · 47 % | 44 · 24 % |
| **250 m** | 101 · 81 % | **46 · 70 %** | 28 · 57 % |
| 350 m | 72 · 88 % | 39 · 81 % | 21 · 72 % |

At 350 m DBSCAN chains the inner city into one cluster of more than 900 cafés. 250 m / 5 keeps neighbourhood
centres apart and is the default.

## Data quality and limits

* 1,797 of 2,619 cafés (68.6 %) have `opening_hours`; **822 do not**. opening_hours.js parses 1,795 of these
  tags, 13 of them with a syntax warning. Two cannot be parsed: `vorübergehend geschlossen` and
  `Sa+So …`. The open-café clusters are therefore a **lower bound**.
* OSM opening hours are entered by volunteers and can be outdated. *Open* means the tag says so. It is
  not a live check.
* `amenity=cafe` includes bakeries with seating, chains, specialty coffee and café-bars.
* DBSCAN results depend on eps and min, so the map lets you change both and shows the effect.

## Build

```bash
pip install -r requirements.txt && npm ci
npm run bundle                      # browser bundle of opening_hours.js
TZ=Europe/Berlin python pipeline/build_data.py
```

The GitHub Action does the same on every push, publishes `docs/` to Pages and pushes the result files to the
`data` branch.

**Outputs** (`docs/data/`): `cafes.geojson`, `stats.json`, `ortsteile.geojson`, `bezirke.geojson`,
`berlin.geojson`, and `berlin_cafes_clusters.gpkg.zip` / `.csv.zip`. The table holds OSM ID, name,
opening_hours, parse status, Ortsteil, Bezirk, baseline cluster and open hours in the reference week.

## Licences and sources

* **Café data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).** The
  derived files in `docs/data` and `data/` are shared under ODbL 1.0 as well.
* Ortsteile and Bezirke: Geoportal Berlin / ALKIS Berlin, [dl-de/zero-2-0](https://www.govdata.de/dl-de/zero-2-0).
* opening_hours.js (LGPL-3.0) and SunCalc (BSD-2-Clause) are bundled in `docs/vendor/` together with their licences.
* Basemap © CARTO, © OpenStreetMap contributors.
* Ester, M., Kriegel, H.-P., Sander, J. & Xu, X. (1996). A density-based algorithm for discovering clusters in
  large spatial databases with noise. *Proc. KDD-96*, 226–231.
* Code: MIT. Made by Barış Parlatangiller for [#30DayMapChallenge](https://30daymapchallenge.com), with AI
  assistance (Claude, Anthropic).
