# Terrain texture credits

All maps are the 1K JPG downloads from Poly Haven, unmodified. Licence:
CC0 1.0 (public domain), https://polyhaven.com/license

| Files | Asset | Author | Real tile size | Source |
| --- | --- | --- | --- | --- |
| `snow_02_diff_1k.jpg`, `snow_02_nor_gl_1k.jpg` | Snow 02 | Rob Tuytel | 2 m | https://polyhaven.com/a/snow_02 |
| `withered_grass_diff_1k.jpg`, `withered_grass_nor_gl_1k.jpg` | Withered Grass | Charlotte Baglioni | 2 m | https://polyhaven.com/a/withered_grass |
| `rock_ground_02_diff_1k.jpg`, `rock_ground_02_nor_gl_1k.jpg` | Rock Ground 02 | Rob Tuytel | 3 m | https://polyhaven.com/a/rock_ground_02 |

`_diff` is sRGB albedo, `_nor_gl` an OpenGL-convention (Y+) tangent-space
normal map. `src/terrainMaterial.js` projects them on world XZ and rescales
the albedo to winter values (snow about 0.82, frozen grass darker).
