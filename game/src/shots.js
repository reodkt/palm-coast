// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// The screenshot scenes behind ?shot=start|play|heat|late|end: each plays the real simulation
// forward from a fresh world with a scripted autopilot driving a real car, so the frame is what
// an actual session looks like, and the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const HEAT_SECONDS = 20;
const LATE_SECONDS = 200;
const END_SECONDS = 400;

function clampAxis(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

/** Steer toward (tx, ty); returns {ax, ay}. */
function steerTo(p, tx, ty) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (Math.hypot(dx, dy) < 20) return { ax: 0, ay: 0 };
  const want = Math.atan2(dy, dx);
  let da = want - p.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return { ax: clampAxis(da * 2.5), ay: -1 };
}

function nearestPickup(world, p, kind) {
  let best = null;
  let bd = Infinity;
  for (const k of world.pickups) {
    if (k.taken || (kind && k.kind !== kind)) continue;
    const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function autopilot(world) {
  const p = world.player;
  const m = world.mission;
  if (m && m.kind === 'collect') {
    const t = m.targets.find((t) => !t.got);
    if (t) return steerTo(p, t.x, t.y);
  }
  if (m && m.kind === 'wreck') {
    const t = m.targets.find((c) => c.hp > 0 && c.role !== 'wreck');
    if (t) return steerTo(p, t.x, t.y);
  }
  const k = nearestPickup(world, p, 'cash');
  if (k) return steerTo(p, k.x, k.y);
  return { ax: 0, ay: -1 };
}

function runWorld(world, seconds, firing) {
  const input = { axes: () => autopilot(world), firing: () => !!firing, takeActions: () => 0 };
  for (let i = 0; i < seconds / STEP; i++) world.step(STEP, input, false);
}

/**
 * Stage the named scene (start, play, heat, late or end) and return the screen to draw over it.
 */
export function stageShot(name, world) {
  if (name !== 'play' && name !== 'heat' && name !== 'late' && name !== 'end') {
    runWorld(world, START_SECONDS, false);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  // seat the player in a nearby car so every scene is a driving scene
  const p = world.player;
  let car = null;
  let bd = Infinity;
  for (const c of world.cars) {
    if (c.role !== 'parked' && c.role !== 'traffic') continue;
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bd) { bd = d; car = c; }
  }
  if (car) { car.role = 'player'; p.car = car; p.onFoot = false; }
  if (name === 'play') {
    runWorld(world, PLAY_SECONDS, false);
  } else if (name === 'heat') {
    world.heat = 3.2;
    world.wanted = 3;
    runWorld(world, HEAT_SECONDS, false);
  } else if (name === 'late') {
    world.dayT = 0.9; // night
    world.money = 2480;
    world.missionsDone = 3;
    runWorld(world, LATE_SECONDS, false);
  } else {
    // end: most of the chain done, night falling over the final haul
    world.dayT = 0.86;
    world.money = 6180;
    world.missionsDone = 6;
    world.cityTaken = true;
    runWorld(world, END_SECONDS, false);
  }
  return { screen: SCREEN_PLAY, best: world.money };
}
