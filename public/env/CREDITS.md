# Environment map credits

| File | Asset | Author | Source | Licence |
| --- | --- | --- | --- | --- |
| `stierberg_sunrise_1k.hdr` | Stierberg Sunrise (1K Radiance HDR) | Grzegorz Wronkowski | https://polyhaven.com/a/stierberg_sunrise (download: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/stierberg_sunrise_1k.hdr) | CC0 1.0 (public domain), https://polyhaven.com/license |

Used only as image-based lighting (`scene.environment`), not as the visible
sky. At load time `src/atmosphere.js` clamps texels brighter than radiance 24
(this removes the sun disc, which the DirectionalLight already provides) and
rotates the map so its brightest texel (u = 0.5996, about 3 degrees above the
horizon) sits under the scene's sun. The file on disk is unmodified.
