import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_LOCATION, SCENE_TIME, sceneSun, solarPosition, sunDirection } from '../src/sun.js';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test('June solstice noon at Greenwich: elevation 90 - lat + 23.44', () => {
  // Solar noon at Greenwich on 2024-06-21 is about 12:02 UTC.
  const sun = solarPosition(new Date(Date.UTC(2024, 5, 21, 12, 2)), 51.4769, 0);
  near(sun.elevation, 90 - 51.4769 + 23.44, .3, 'elevation');
  near(sun.azimuth, 180, 1.5, 'azimuth');
  near(sun.declination, 23.44, .05, 'declination');
});

test('March equinox: declination near zero, sun near zenith at the equator', () => {
  // Equinox instant was 03:06 UTC; nine hours later the declination is ~+0.15.
  const sun = solarPosition(new Date(Date.UTC(2024, 2, 20, 12, 7)), 0, 0);
  near(sun.declination, .15, .05, 'declination');
  near(sun.elevation, 90, .6, 'elevation');
});

test('morning sun is in the east, evening sun in the west', () => {
  const morning = solarPosition(new Date(Date.UTC(2024, 8, 22, 6)), 48.85, 2.35);
  const evening = solarPosition(new Date(Date.UTC(2024, 8, 22, 17)), 48.85, 2.35);
  assert.ok(morning.azimuth > 60 && morning.azimuth < 120, `morning ${morning.azimuth}`);
  assert.ok(evening.azimuth > 240 && evening.azimuth < 300, `evening ${evening.azimuth}`);
});

test('Kalenovo, late-November afternoon: low winter sun in the south-west quadrant', () => {
  const sun = sceneSun();
  assert.equal(SCENE_TIME.toISOString(), '2025-11-25T06:00:00.000Z');
  assert.ok(sun.elevation > 14 && sun.elevation < 20, `elevation ${sun.elevation}`);
  assert.ok(sun.azimuth > 190 && sun.azimuth < 240, `azimuth ${sun.azimuth}`);
  // Highest the sun gets that day: about 90 - 51.76 - 20.8 = 17.4 degrees.
  let max = -90;
  for (let m = 0; m < 1440; m += 5) max = Math.max(max, solarPosition(new Date(Date.UTC(2025, 10, 24, 16) + m * 60000), SCENE_LOCATION.lat, SCENE_LOCATION.lon).elevation);
  near(max, 90 - SCENE_LOCATION.lat - 20.8, .3, 'noon elevation');
});

test('sunDirection maps azimuth/elevation to scene axes (+x east, +y up, +z south)', () => {
  const v = (az, el) => Object.values(sunDirection(az, el));
  const close = (a, b) => a.forEach((x, i) => near(x, b[i], 1e-12, `component ${i}`));
  close(v(0, 0), [0, 0, -1]);
  close(v(90, 0), [1, 0, 0]);
  close(v(180, 0), [0, 0, 1]);
  close(v(270, 0), [-1, 0, 0]);
  close(v(123, 90), [0, 1, 0]);
  const d = sceneSun().direction;
  near(Math.hypot(d.x, d.y, d.z), 1, 1e-12, 'unit length');
  assert.ok(d.x < 0 && d.z > 0 && d.y > 0, 'south-west and above the horizon');
});
