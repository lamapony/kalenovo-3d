# Data sources

Everything in `public/data/` comes from open datasets. The scene does not add
names, landmarks or history that are not in these sources.

## Elevation: Copernicus DEM GLO-30

- Dataset: Copernicus DEM GLO-30 (30 m global DSM), 1 x 1 degree tile **N51 E107**
  (`glo30_N51_E107.tif`, 2400 x 3600 px, 1.5 x 1 arc-second pixels).
- Vertical datum: **EGM2008** geoid; heights are metres above it.
- Licence: free to use under the Copernicus DEM licence. Required attribution
  (also in the page footer):

  > Copernicus DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

### How the heightmaps were made

`tools/make_dem.py` samples the tile on a local metric grid centred on the
scene centre in `meta.json` (`x = (lon - centerLon) * metersPerDegLon`,
`z = -(lat - centerLat) * metersPerDegLat`), treating GLO-30 pixels as point
samples (`AREA_OR_POINT=Point`), with scipy `map_coordinates`:

```sh
python3 tools/make_dem.py --dem glo30_N51_E107.tif --meta public/data/meta.json --out public/data
# optional: --check-old public/data/heightmap.f32 prints the difference to the older 257 grid
```

| File | Grid | Area | Spacing | Resampling |
| --- | --- | --- | --- | --- |
| `heightmap-513.f32` | 513 x 513 | ±1800 m (walkable near tile) | 7.03 m | cubic spline (interpolated, no extra detail beyond ~30 m) |
| `heightmap-far-7500m-257.f32` | 257 x 257 | ±7500 m (horizon ring) | 58.6 m | cubic spline |
| `heightmap.f32`, `heightmap-16bit.png` | 257 x 257 | ±1800 m | 14.1 m | bilinear (older files, no longer loaded at runtime) |

Layout of the `.f32` files (see `dem-info.json`): Float32 little-endian,
row-major, row 0 = north (`z = -half`), column 0 = west (`x = -half`).

In the scene, heights are taken relative to `meta.centerElev` and multiplied by
`VERTICAL_EXAGGERATION = 1.25` (`src/heightfield.js`), the same factor for the
near tile, the far ring and the ground sampler.

## Map features: OpenStreetMap

`osm.geojson` (roads, waterways, woods, a few buildings). © OpenStreetMap
contributors, licensed under the Open Database License (ODbL).

## Building footprints: GlobalBuildingAtlas

`buildings-gba.geojson`. GlobalBuildingAtlas (Technical University of Munich),
CC BY-NC 4.0 (non-commercial use). OSM buildings take precedence where both
overlap.

## Sun position

Not data, but derived: `src/sun.js` computes the sun direction for
25 November 2025, 14:00 local time (UTC+8) at the scene centre with the NOAA
solar position algorithm (elevation about 15°, azimuth about 200°).
`?tod=sunset` uses 16:20 the same day (about 3° high, azimuth about 230°).
`?tod=night` uses 21:00; its moonlight direction is artistic (azimuth 130°,
32° high), not a lunar ephemeris.

## Lighting and textures (art assets, not data about the village)

- Image-based lighting: **Stierberg Sunrise** HDRI by Grzegorz Wronkowski,
  Poly Haven, CC0 1.0. https://polyhaven.com/a/stierberg_sunrise
  File `public/env/stierberg_sunrise_1k.hdr`; details in `public/env/CREDITS.md`.
- Ground textures (Poly Haven, CC0 1.0), in `public/textures/terrain/`,
  details in `public/textures/terrain/CREDITS.md`:
  **Snow 02** (Rob Tuytel, https://polyhaven.com/a/snow_02),
  **Withered Grass** (Charlotte Baglioni, https://polyhaven.com/a/withered_grass),
  **Rock Ground 02** (Rob Tuytel, https://polyhaven.com/a/rock_ground_02).

CC0 needs no attribution; the footer credits Poly Haven anyway. The sky,
clouds, fog and colour grade are procedural (`src/atmosphere.js`, `src/post.js`).
