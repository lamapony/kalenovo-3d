// Global season switch (?season=summer). Set once in main.js before any material or
// geometry is created; materials and builders read it at creation time. Pure, no three.js.
export const season = { name: 'winter', summer: false };

export function setSeason(name) {
  season.name = name === 'summer' ? 'summer' : 'winter';
  season.summer = season.name === 'summer';
  return season;
}
