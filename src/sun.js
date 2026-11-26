// Solar position (pure, no three.js) using the NOAA / Meeus low-precision
// algorithm: accurate to roughly 0.1 degree for 1950-2050, which is far finer
// than anything visible in the scene. No atmospheric refraction is applied.

const RAD = Math.PI / 180;

// Kalenovo scene centre (public/data/meta.json).
export const SCENE_LOCATION = { lat: 51.757214, lon: 107.114639 };

// Late-November afternoon: 25 Nov 2025, 14:00 local time. Buryatia keeps
// UTC+8, so this is 06:00 UTC. The sun is then about 15 degrees high,
// south-south-west (azimuth about 200 degrees).
export const SCENE_TIME = new Date(Date.UTC(2025, 10, 25, 6, 0, 0));

/**
 * @param {Date} date UTC instant
 * @param {number} lat latitude in degrees, north positive
 * @param {number} lon longitude in degrees, east positive
 * @returns {{elevation:number, azimuth:number, declination:number}} degrees;
 *   azimuth is measured clockwise from true north (180 = south).
 */
export function solarPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan(eps * RAD / 2) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD)
    + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD)); // minutes
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  const solarTime = ((minutes + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const hourAngle = (solarTime / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZenith = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle)));
  const elevation = 90 - Math.acos(cosZenith) / RAD;
  const azimuth = ((Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180) % 360 + 360) % 360;
  return { elevation, azimuth, declination: decl / RAD };
}

/**
 * Unit vector pointing from the scene towards the sun, in scene axes:
 * +x = east, +y = up, +z = south (the DEM grid has row 0 in the north).
 */
export function sunDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * RAD, el = elevationDeg * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

export function sceneSun(date = SCENE_TIME, { lat, lon } = SCENE_LOCATION) {
  const position = solarPosition(date, lat, lon);
  return { ...position, direction: sunDirection(position.azimuth, position.elevation) };
}
