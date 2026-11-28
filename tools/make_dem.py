#!/usr/bin/env python3
"""Resample a Copernicus DEM GLO-30 tile into the Float32 heightmaps used by the walk.

Example:
  python3 tools/make_dem.py --dem glo30_N51_E107.tif --meta public/data/meta.json \
      --out public/data [--check-old public/data/heightmap.f32]

Writes heightmap-513.f32 (near tile, same +-halfSizeM area as meta.json),
heightmap-far-7500m-257.f32 (+-7500 m) and dem-info.json. Layout: Float32
little-endian, row-major, row 0 = north (z=-half), col 0 = west (x=-half),
metres above the EGM2008 geoid (the GLO-30 vertical datum).
Needs numpy, rasterio and scipy.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from scipy.ndimage import map_coordinates


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dem', required=True, help='Copernicus GLO-30 GeoTIFF tile (e.g. glo30_N51_E107.tif)')
    ap.add_argument('--meta', required=True, help='scene meta.json (centre, metres per degree, halfSizeM)')
    ap.add_argument('--out', default='.', help='output directory (default: current directory)')
    ap.add_argument('--near-size', type=int, default=513, help='near grid size (default 513)')
    ap.add_argument('--far-size', type=int, default=257, help='far grid size (default 257)')
    ap.add_argument('--far-half', type=float, default=7500, help='far grid half size in metres (default 7500)')
    ap.add_argument('--check-old', help='optional older 257 bilinear heightmap.f32 to compare against')
    args = ap.parse_args()

    meta = json.loads(Path(args.meta).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(args.dem) as d:
        A = d.read(1).astype(np.float64)
        inv = ~d.transform
        shape = f'{d.width}x{d.height} px'

    def grid(half, n, order):
        t = np.linspace(-half, half, n)
        X, Z = np.meshgrid(t, t)  # row index = z (north first)
        lon = meta['centerLon'] + X / meta['metersPerDegLon']
        lat = meta['centerLat'] - Z / meta['metersPerDegLat']
        col, row = inv * (lon, lat)
        # AREA_OR_POINT=Point: pixel centres sit at integer+0.5 in affine terms.
        return map_coordinates(A, [row - 0.5, col - 0.5], order=order, mode='nearest').astype('<f4')

    if args.check_old:
        old = np.fromfile(args.check_old, '<f4').reshape(257, 257)
        chk = grid(meta['halfSizeM'], 257, 1)
        print('diff vs existing bilinear: mean %.3f max %.3f' % (np.abs(chk - old).mean(), np.abs(chk - old).max()))

    near_name = f'heightmap-{args.near_size}.f32'
    far_name = f'heightmap-far-{args.far_half:g}m-{args.far_size}.f32'
    near = grid(meta['halfSizeM'], args.near_size, 3)
    near.tofile(out / near_name)
    far = grid(args.far_half, args.far_size, 3)
    far.tofile(out / far_name)
    info = {
        'source': f'Copernicus DEM GLO-30, 1x1 deg tile N51 E107 ({shape}, 1.5 x 1 arcsec), file {Path(args.dem).name}',
        'near': {'file': near_name, 'gridSize': args.near_size, 'halfSizeM': meta['halfSizeM'],
                 'min': float(near.min()), 'max': float(near.max()),
                 'resampling': 'cubic spline from ~30 m native; spacing %.2f m (interpolated, not extra detail)' % (2 * meta['halfSizeM'] / (args.near_size - 1))},
        'far': {'file': far_name, 'gridSize': args.far_size, 'halfSizeM': args.far_half,
                'min': float(far.min()), 'max': float(far.max()),
                'resampling': 'cubic spline, spacing %.1f m' % (2 * args.far_half / (args.far_size - 1))},
        'layout': 'Float32 little-endian, row-major; row 0 = z=-half (north), col 0 = x=-half (west); '
                  'x=(lon-centerLon)*metersPerDegLon, z=-(lat-centerLat)*metersPerDegLat; metres above EGM2008 geoid',
    }
    (out / 'dem-info.json').write_text(json.dumps(info, indent=1))
    print(json.dumps(info, indent=1))


if __name__ == '__main__':
    main()
