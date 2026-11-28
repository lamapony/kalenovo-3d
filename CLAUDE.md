@~/code/agent-rules/AGENTS.md

# Kalenovo 3D

Browser walk through the real village of Kalenovo (Калёново), Ivolginsky District, Buryatia, in the first snow.

## Stack
- three.js r187, `WebGPURenderer` from `three/webgpu` (falls back to its WebGL2 backend automatically; `?webgl=1` forces it). TSL node materials, `RenderPipeline` post-processing.
- Vite 6, plain ES modules, no framework. Vite aliases `three` to the WebGPU build.
- Tests: `node:test`. Lint: ESLint flat config.

## Layout
- `src/main.js` bootstraps renderer, data, scene, loop. `src/params.js` URL switches.
- `src/heightfield.js` pure heightmap parsing + bilinear ground sampler (tested). `src/terrain.js` near tile + far ring meshes, `src/terrainMaterial.js` procedural TSL ground.
- `src/sun.js` pure solar position (tested). `src/atmosphere.js` SkyMesh sky + haze, fog, sun with CSM shadows, GPU snow.
- `src/post.js` GTAO, bloom, vignette, ACES. `src/debug.js` `?debug=1` overlay and read-only `window.__kalenovo`.
- `src/buildings.js`: улица Толстихина from house passports (`data/main-street-houses.json`, schema and pure helpers in `src/village/passports.js`, tested) built with the kit in `src/village/kit/` (`spec.js` pure passport -> spec, roof geometry, window slots, board patterns; `layout.js` pure plots, palisades, yard lines with gates, side and gap fences, outbuildings, reserved areas; `house.js` log/clapboard/siding/brick houses, roofs, наличники, shutters, gables, verandas; `fences.js` passport fences and gates; `materials.js` procedural roofing, fence and yard materials; `yard.js` pure seeded yard content (beds, banya, shed, woodpile, greenhouse, outhouse, garden trees) and `yardBuild.js` its geometry; `groundMask.js` pure ground mask (trodden dirt, gravel drives, tilled soil) rasterised for the terrain shader; all tested in `test/kit.test.js`). `main.js` computes the main-street layout first (`mainStreetLayout`) so the terrain gets the ground mask. Generic village content keeps out of passport plots. Family house = passport `tolstikhina-45`, labelled «Толстихина, 45».
- `src/season.js` global season (`?season=summer`), read at material creation.
- Generic procedural village from `src/village/*`: `plan.js` pure plots/fences layout (tested), `house.js`, `builder.js` tiled merged meshes with near/detail/far LOD, `materials.js`, `poles.js`, `smoke.js`), `src/fences.js`, `src/paths.js` (two-layer road ribbons: banks then tracks), `src/forest.js`, `src/grass.js`, `src/textures.js`, `src/controls.js` (house + fence collision), `src/geo.js`.
- LODs are updated once per frame from the view camera in `main.js` (`autoUpdate = false`), never by shadow cameras.
- `public/textures/<set>/` village textures (`public/textures/CREDITS.md`), `public/textures/terrain/` ground textures (own CREDITS.md).
- `public/data/`: `meta.json`, `dem-info.json`, `heightmap-513.f32`, `heightmap-far-7500m-257.f32`, `osm.geojson`, `buildings-gba.geojson`. Provenance in `DATA-SOURCES.md`; regenerate DEM with `tools/make_dem.py`.
- `.claude/skills/` (vendored from github.com/CloudAI-X/threejs-skills): MIT three.js skills (CloudAI-X), read the WebGPU/TSL sections before renderer work.

## Commands
- `npm run dev`, `npm run build`, `npm test`, `npm run lint`.
- URL switches: `?webgl=1`, `?quality=low|high`, `?debug=1`, `?cam=x,z,yawDeg,pitchDeg,height` (inspection view), `?cam=ll:lat,lon,N|S,pitch,height` (street imagery framing: looks perpendicular to улица Толстихина), `?fov=deg` (vertical FOV), `?season=summer` (August, no snow; default first snow), `?tod=`, `?view=street|bird`, `?nohud=1`, `?tm=agx`.

## Rules
- Never invent facts about the village: no made-up names, landmarks, history. The only address shown is the owner's family house «Толстихина, 45» (owner passport).
- Main-street passports come from own observation of public street imagery (Aug 2021). Never copy, commit or derive files from those images into the repo; keep only derived parameters in `data/main-street-houses.json`.
- Keep data attributions (OSM ODbL, Copernicus DEM text, GlobalBuildingAtlas CC BY-NC 4.0) in the footer and `DATA-SOURCES.md`.
- One `VERTICAL_EXAGGERATION` for all terrain. Everything placed on the ground uses `getGroundHeight`.
- Check both backends (`?webgl=1`) and both qualities before calling visual work done.
