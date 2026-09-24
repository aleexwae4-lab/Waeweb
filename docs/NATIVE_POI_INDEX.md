# WAEWEB Native POI Index — no paid API

The live `/api/nearby` endpoint is now **native-first**. If an operator-provided
index exists and covers the user's authorized coordinate, the request is answered
from local, self-owned search logic. It makes **zero upstream Overpass requests**.
This is not a claim that WAEWEB already has a Mexico-wide POI dataset.

## Offline ingestion

1. Obtain an **actual** OSM-derived GeoJSON FeatureCollection or GeoJSON Sequence
   extract for a limited city/region, with OSM IDs, point coordinates, names,
   shop/amenity and optional brand/address properties. Do not substitute
   artificially generated businesses or points. Raw `.osm.pbf` is **not**
   directly supported by this importer; convert it offline with tooling such
   as osmium or another appropriate GIS exporter first.
2. Run from the repository root:
   `WAE_OSM_SNAPSHOT=2026-09-24 WAE_OSM_COVERAGE=Zapopan node scripts/import-pois.mjs /path/to/poi.geojsonseq`
3. Install the generated `data/pois.ndjson` in the running release, or set
   `WAE_POI_INDEX_PATH=/absolute/path/to/pois.ndjson` to a persistent mounted
   file. Check `GET /api/nearby/status` for the **real** document count,
   snapshot, coverage label and availability. No secret or private geolocation
   is imported.
4. To prohibit upstream POI calls, set
   `WAE_NEARBY_EXTERNAL_FALLBACK=false`. Without an installed valid snapshot,
   WAEWEB then returns **503, no native data**, rather than showing invented
   stores or silently contacting Overpass.

This pilot limits the output to 120,000 POIs and the read-only index to 40 MB.
A larger regional/national engine requires sharding or a dedicated persistent
geospatial store (e.g., PostgreSQL/PostGIS), appropriate server resources,
update jobs, and a recovery plan. Render free instances do not make
an operator-uploaded ephemeral runtime file durable.

## What is / is not native

- Native now: POI category matching, geographic bucket index, 3.5 km radius,
  straight-line distance sorting, deterministic response, local source
  metadata, consent-gated location UX, exact-site directory (including Telcel).
- Transitionally external until switched off: Overpass fallback when no local
  dataset covers a coordinate. Its behavior is visible in
  `/api/nearby/status`.
- Separately external: map background tiles, routing, geocoding, news,
  websites not yet discovered/indexed, and any other third-party provider.
  A POI index does **not** make the map renderer or full web search offline.
- WAEWEB cannot infer live opening times or existence from an OSM extract.
  Preserve OSM attribution; evaluate ODbL obligations, especially if combining
  commercial marketplace data with the derived OSM database.

## Verification

Run `node --test tests/native-poi.test.mjs tests/nearby-intent.test.mjs`,
`npm run check` and `npm test` before rollout. Synthetic test fixtures are
not shipped as real POIs.
