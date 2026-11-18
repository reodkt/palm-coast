// PALM COAST final build - recorded agent commit
// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// The world: the city grid, everything that lives in it, and the simulation.
// PALM COAST is a 54x54-tile grid; roads run every 6 tiles both ways, the 4x4 blocks
// between them hold buildings, parks and parking lots. Traffic drives the road lanes,
// pedestrians walk the sidewalks, cops chase when the heat rises, missions pay cash.
import {
  CAR, COLORS, COP_BASE_SPEED, COP_LIGHTS, COUNTS, DISTRICTS, MH, MW, PLAYER, STEP, T_BUILDING, T_LOT, T_PARK,
  T_ROAD, T_SIDEWALK, TILE, TRAFFIC_SPEED, WORLD_H, WORLD_W,
} from './config.js';
import { createRandom, hash2 } from './random.js';

export const EV_EVENT_NONE = 0;
export const EV_PLAYER_DEAD = 1;
export const EV_BUSTED = 2;

// The story: seven chained jobs for Manny, each with a line of dialogue. Finishing all
// seven ends the run with "CITY TAKEN".
const MISSIONS = [
  { id: 'collect', brief: 'Pick up the drop at the marina.', dialog: 'Manny: "Easy money, primo — three bags by the water. Don\'t be late."', reward: 400, count: 3, kind: 'collect' },
  { id: 'wreck', brief: 'Wreck the rival gang cars prowling the docks.', dialog: 'Manny: "Los Muertos are muscling in. Turn their rides into scrap."', reward: 650, count: 3, kind: 'wreck' },
  { id: 'steal', brief: 'Boost a car and lose the heat.', dialog: 'Manny: "I need wheels that aren\'t ours. Jack one, then shake the stars."', reward: 700, count: 1, kind: 'steal' },
  { id: 'collect', brief: 'Collect the cocaine pallets off the Strip.', dialog: 'Manny: "Big score tonight. Three pallets, Mirage Strip. Move fast."', reward: 850, count: 4, kind: 'collect' },
  { id: 'survive', brief: 'Lose the heat: survive 40 seconds at 2+ stars.', dialog: 'Manny: "Cops are onto us. Get loud and get gone — 40 seconds, hermano."', reward: 900, count: 1, kind: 'survive' },
  { id: 'wreck', brief: 'Ambush the police convoy downtown.', dialog: 'Manny: "Last piece of the plan. Send their convoy to the junkyard."', reward: 1100, count: 4, kind: 'wreck' },
  { id: 'collect', brief: 'Grab the final payoff stash — three cases.', dialog: 'Manny: "This is it, Johnny. Three cases and the Coast is ours."', reward: 1500, count: 3, kind: 'collect' },
];

const PED_NAMES = ['Manny', 'Rosa', 'Duke', 'Vera', 'Chico', 'Lupe', 'Bones', 'Sal', 'Nina', 'Tito'];
const CAR_COLORS = ['#c94f43', '#4372b8', '#c9b458', '#5c9c5c', '#8a5cb0', '#b8b8b8', '#4a4a52', '#d08f3f', '#5aa8a0'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** True when the tile at grid (tx, ty) is drivable road. */
function isRoad(world, tx, ty) {
  return tx >= 0 && ty >= 0 && tx < world.mw && ty < world.mh && world.tiles[ty * world.mw + tx] === T_ROAD;
}

/** True when walkable (sidewalk, park, lot). */
function isWalkable(world, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= world.mw || ty >= world.mh) return false;
  const t = world.tiles[ty * world.mw + tx];
  return t === T_SIDEWALK || t === T_PARK || t === T_LOT;
}

/** True when a car body can be there (road, lot, park — not buildings, not sidewalk). */
function isDrivable(world, x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= world.mw || ty >= world.mh) return false;
  const t = world.tiles[ty * world.mw + tx];
  return t === T_ROAD || t === T_LOT || t === T_PARK;
}

export function createWorld(seed) {
  const rand = createRandom(seed);
  const mw = MW;
  const mh = MH;
  const tiles = new Uint8Array(mw * mh);
  const world = {
    seed, rand, mw, mh, tiles, time: 0,
    buildings: [], trees: [], blocks: [],
    player: null, cars: [], peds: [], cops: [], bullets: [], pickups: [], particles: [], texts: [], skidMarks: [],
    heat: 0, wanted: 0, heatCool: 0, money: 0, bank: 0,
    mission: null, missionsDone: 0, missionTimer: 0, surviveTimer: 0,
    district: null, districtT: 0, dialog: null, dialogT: 0, cityTaken: false,
    stats: { kills: 0, steals: 0, deliveries: 0 },
    dead: false, busted: false, deadTimer: 0, dayT: 0.28,
    events: [],
  };

  // --- city grid: roads every 6 tiles, 2 tiles wide ---
  for (let ty = 0; ty < mh; ty++) {
    for (let tx = 0; tx < mw; tx++) {
      const gx = tx % 6;
      const gy = ty % 6;
      const road = gx === 0 || gx === 1 || gy === 0 || gy === 1;
      tiles[ty * mw + tx] = road ? T_ROAD : 0;
    }
  }

  // --- blocks between roads ---
  for (let by = 0; by < mh; by += 6) {
    for (let bx = 0; bx < mw; bx += 6) {
      if (by + 6 > mh || bx + 6 > mw) continue;
      const r = hash2(bx, by, seed);
      const kind = r < 0.16 ? 'park' : r < 0.28 ? 'lot' : 'buildings';
      world.blocks.push({ bx, by, kind, palette: Math.floor(hash2(bx, by, seed + 7) * 6) });
      if (kind === 'park') {
        for (let ty = by + 2; ty < by + 6; ty++) {
          for (let tx = bx + 2; tx < bx + 6; tx++) {
            if (ty < mh && tx < mw) tiles[ty * mw + tx] = T_PARK;
          }
        }
        const n = 3 + Math.floor(hash2(bx, by, seed + 3) * 4);
        for (let i = 0; i < n; i++) {
          world.trees.push({
            x: (bx + 2.4 + hash2(bx * 13 + i, by * 7, seed) * 3.2) * TILE,
            y: (by + 2.4 + hash2(bx * 5, by * 17 + i, seed) * 3.2) * TILE,
            r: 10 + hash2(i, bx, by) * 8,
          });
        }
      } else if (kind === 'lot') {
        for (let ty = by + 2; ty < by + 6; ty++) {
          for (let tx = bx + 2; tx < bx + 6; tx++) {
            if (ty < mh && tx < mw) tiles[ty * mw + tx] = T_LOT;
          }
        }
      } else {
        // buildings: subdivide the 4x4 block into 2-4 footprints with sidewalk margin
        for (let ty = by + 2; ty < by + 6; ty++) {
          for (let tx = bx + 2; tx < bx + 6; tx++) {
            if (ty < mh && tx < mw) tiles[ty * mw + tx] = T_BUILDING;
          }
        }
        const pal = Math.floor(hash2(bx * 3, by * 11, seed) * 6);
        const cuts = hash2(bx, by, seed + 21) < 0.5;
        const rects = cuts
          ? [[2, 2, 2, 1], [2, 3, 2, 1], [4, 2, 2, 2]]
          : [[2, 2, 4, 2], [2, 4, 2, 2], [4, 4, 2, 2]];
        for (const [ox, oy, w, h] of rects) {
          world.buildings.push({
            x: (bx + ox) * TILE, y: (by + oy) * TILE, w: w * TILE, h: h * TILE,
            palette: pal, seed: hash2(bx + ox, by + oy, seed),
          });
        }
      }
    }
  }

  // --- player: on a sidewalk near the city centre ---
  const px = (27 * 6 - 2) * TILE;
  const py = (27 * 6 - 2) * TILE;
  world.player = {
    x: px, y: py, vx: 0, vy: 0, angle: 0, onFoot: true, hp: PLAYER.maxHp, maxHp: PLAYER.maxHp,
    car: null, fireCd: 0, walkPhase: 0, name: 'Johnny Vega',
  };

  // --- traffic ---
  for (let i = 0; i < COUNTS.traffic; i++) spawnTrafficCar(world, rand);
  // --- parked cars on lots ---
  for (const b of world.blocks) {
    if (b.kind !== 'lot') continue;
    const n = 1 + Math.floor(hash2(b.bx, b.by, seed + 5) * 3);
    for (let i = 0; i < n; i++) {
      const x = (b.bx + 2.6 + i * 1.2) * TILE;
      const y = (b.by + 3.2 + hash2(b.bx + i, b.by, seed) * 1.5) * TILE;
      world.cars.push(makeCar(x, y, Math.PI / 2, rand.pick(CAR_COLORS), 'parked'));
    }
  }
  // --- pedestrians ---
  for (let i = 0; i < COUNTS.peds; i++) spawnPed(world, rand);
  // --- cash pickups scattered downtown ---
  for (let i = 0; i < 26; i++) {
    const tx = rand.int(2, mw - 3);
    const ty = rand.int(2, mh - 3);
    if (tiles[ty * mw + tx] === T_SIDEWALK || tiles[ty * mw + tx] === T_PARK) {
      world.pickups.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, kind: 'cash', value: 60, taken: false });
    }
  }
  // a few health packs
  for (let i = 0; i < 10; i++) {
    const tx = rand.int(2, mw - 3);
    const ty = rand.int(2, mh - 3);
    if (tiles[ty * mw + tx] !== T_BUILDING) {
      world.pickups.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, kind: 'health', value: 35, taken: false });
    }
  }
  return world;
}

function makeCar(x, y, angle, color, role) {
  return { x, y, angle, speed: 0, color, role, hp: 60, driver: role === 'traffic', targetLane: null, honk: 0, burn: 0, wobble: Math.random() * 6 };
}

function spawnTrafficCar(world, rand) {
  for (let tries = 0; tries < 40; tries++) {
    // pick a road lane: horizontal roads at ty%6 in (0,1), vertical at tx%6 in (0,1)
    const horiz = rand.chance(0.5);
    const lane = rand.int(0, Math.floor((horiz ? world.mh : world.mw) / 6) - 1) * 6 + (rand.chance(0.5) ? 0 : 1);
    const t = rand.range(3, (horiz ? world.mw : world.mh) - 3);
    const x = horiz ? t * TILE : lane * TILE + (lane % 6 === 0 ? TILE * 0.5 : TILE * 1.5);
    const y = horiz ? lane * TILE + (lane % 6 === 0 ? TILE * 0.5 : TILE * 1.5) : t * TILE;
    const angle = horiz ? (lane % 6 === 0 ? 0 : Math.PI) : (lane % 6 === 0 ? Math.PI / 2 : -Math.PI / 2);
    if (!isDrivable(world, x, y)) continue;
    world.cars.push(makeCar(x, y, angle, rand.pick(CAR_COLORS), 'traffic'));
    return;
  }
}

function spawnPed(world, rand) {
  for (let tries = 0; tries < 40; tries++) {
    const tx = rand.int(2, world.mw - 3);
    const ty = rand.int(2, world.mh - 3);
    const x = tx * TILE + TILE / 2;
    const y = ty * TILE + TILE / 2;
    if (!isWalkable(world, x, y)) continue;
    world.peds.push({
      x, y, angle: rand.range(0, Math.PI * 2), speed: rand.range(24, 46),
      color: rand.pick(['#d9a066', '#8c6b4f', '#c48d6a', '#6b4f3a', '#e0b088']),
      shirt: rand.pick(['#c94f43', '#4372b8', '#c9b458', '#5c9c5c', '#8a5cb0', '#ddd', '#333']),
      panic: 0, phase: rand.range(0, 6), name: rand.pick(PED_NAMES), dead: false, deadT: 0,
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function step(world, input, dt) {
  world.events.length = 0;
  world.time += dt;
  world.dayT = (world.dayT + dt / 240) % 1;

  updatePlayer(world, input, dt);
  updateTraffic(world, dt);
  updatePeds(world, dt);
  updateCops(world, dt);
  updateBullets(world, dt);
  updateParticles(world, dt);
  updateSkidMarks(world, dt);
  updateHeat(world, dt);
  updateMission(world, dt);
  updateDistrict(world, dt);

  if (world.dialogT > 0) world.dialogT -= dt;

  // balance: slow out-of-combat regen so WASTED doesn't come too fast
  const p = world.player;
  if (!world.dead && !world.busted && p.hp < p.maxHp && world.cops.length === 0 && world.wanted === 0) {
    p.hp = Math.min(p.maxHp, p.hp + 3 * dt);
  }
  // balance: BUSTED grace — a cop must stay close for 0.8s to pinch you
  if (world.bustedGrace > 0) world.bustedGrace -= dt;

  for (const t of world.texts) t.life -= dt;
  world.texts = world.texts.filter((t) => t.life > 0);

  if (world.dead || world.busted) {
    world.deadTimer += dt;
  }
  return world.events;
}

function addText(world, x, y, str, color) {
  world.texts.push({ x, y, str, color: color || '#fff', life: 1.4, max: 1.4 });
}

function burst(world, x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = Math.random() * spd;
    world.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, color, size: 2 + Math.random() * 3 });
  }
}

// --- player ---

function updatePlayer(world, input, dt) {
  const p = world.player;
  if (world.dead || world.busted) return;
  const { ax, ay } = input.axes();

  if (p.onFoot) {
    const len = Math.hypot(ax, ay) || 1;
    const spd = PLAYER.walk;
    p.vx = (ax / len) * spd * (ax || ay ? 1 : 0);
    p.vy = (ay / len) * spd * (ay || ax ? 1 : 0);
    p.x = clamp(p.x + p.vx * dt, TILE, WORLD_W - TILE);
    p.y = clamp(p.y + p.vy * dt, TILE, WORLD_H - TILE);
    // collide with buildings
    for (const b of world.buildings) {
      if (p.x > b.x - PLAYER.radius && p.x < b.x + b.w + PLAYER.radius && p.y > b.y - PLAYER.radius && p.y < b.y + b.h + PLAYER.radius) {
        const dl = p.x - (b.x - PLAYER.radius);
        const dr = b.x + b.w + PLAYER.radius - p.x;
        const dt2 = p.y - (b.y - PLAYER.radius);
        const db = b.y + b.h + PLAYER.radius - p.y;
        const m = Math.min(dl, dr, dt2, db);
        if (m === dl) p.x = b.x - PLAYER.radius;
        else if (m === dr) p.x = b.x + b.w + PLAYER.radius;
        else if (m === dt2) p.y = b.y - PLAYER.radius;
        else p.y = b.y + b.h + PLAYER.radius;
      }
    }
    if (ax || ay) {
      p.angle = Math.atan2(ay, ax);
      p.walkPhase += dt * 9;
    }
    // enter nearest car
    if (input.takeActions() & 1) {
      let best = null;
      let bd = 52 * 52;
      for (const c of world.cars) {
        if (c.role === 'cop') continue;
        const d = dist2(p.x, p.y, c.x, c.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        if (best.role === 'traffic') {
          world.stats.steals++;
          raiseHeat(world, 1, 'Grand theft auto!');
        }
        best.role = 'player';
        best.driver = false;
        p.car = best;
        p.onFoot = false;
        world.audio && world.audio.door();
      }
    }
    // shoot
    p.fireCd -= dt;
    if (input.firing() && p.fireCd <= 0) {
      p.fireCd = PLAYER.fireCooldown;
      world.bullets.push({
        x: p.x + Math.cos(p.angle) * 14, y: p.y + Math.sin(p.angle) * 14,
        vx: Math.cos(p.angle) * PLAYER.bulletSpeed, vy: Math.sin(p.angle) * PLAYER.bulletSpeed,
        life: 0.8, from: 'player',
      });
      world.audio && world.audio.shot();
      raiseHeat(world, world.wanted < 1 ? 1 : 0, world.wanted < 1 ? 'Firearm discharged!' : null);
    }
  } else {
    // driving — analog-style: velocity-based with smooth accel, light drift, skid marks
    const c = p.car;
    const throttle = -ay;
    // smooth longitudinal control: throttle ramps, brakes bite harder
    if (throttle > 0) c.speed = Math.min(CAR.maxSpeed, c.speed + CAR.accel * throttle * dt);
    else if (throttle < 0) c.speed = Math.max(CAR.reverse, c.speed + CAR.brake * throttle * dt);
    else c.speed *= Math.pow(CAR.coastDrag, dt);
    const braking = throttle < 0 && c.speed > 0;
    // steering scales with speed (full authority at low speed, tapers at top end)
    const steerAuth = clamp(Math.abs(c.speed) / 60, 0, 1) * (1 - 0.4 * Math.abs(c.speed) / CAR.maxSpeed);
    const grip = 1 - Math.min(0.7, Math.abs(c.speed) / CAR.maxSpeed) * 0.55;
    if (ax) c.angle += ax * CAR.turn * dt * grip * steerAuth * Math.sign(c.speed || 1);
    // light drift: velocity lags behind the heading at speed, more when braking hard
    const speedRatio = Math.abs(c.speed) / CAR.maxSpeed;
    const slip = braking && speedRatio > 0.55 ? CAR.driftSlip - 0.12 : CAR.driftSlip;
    const fwd = Math.cos(c.angle) * c.speed;
    const lat = Math.sin(c.angle) * c.speed;
    const smooth = 1 - Math.pow(slip, dt * 6);
    c.vx = (c.vx || 0) + (fwd - (c.vx || 0)) * smooth;
    c.vy = (c.vy || 0) + (lat - (c.vy || 0)) * smooth;
    const nx = c.x + c.vx * dt;
    const ny = c.y + c.vy * dt;
    if (isDrivable(world, nx, c.y)) c.x = nx;
    else { c.vx *= -0.3; c.speed *= -0.3; damageCar(world, c, 4); }
    if (isDrivable(world, c.x, ny)) c.y = ny;
    else { c.vy *= -0.3; c.speed *= -0.3; damageCar(world, c, 4); }
    c.x = clamp(c.x, TILE, WORLD_W - TILE);
    c.y = clamp(c.y, TILE, WORLD_H - TILE);
    // skid marks when braking hard or drifting wide
    const sideways = Math.hypot(c.vx - fwd, c.vy - lat);
    if ((braking && c.speed > CAR.skidSpeed) || sideways > 55) {
      for (let s = -1; s <= 1; s += 2) {
        world.skidMarks.push({
          x: c.x + Math.cos(c.angle + Math.PI / 2) * s * 10,
          y: c.y + Math.sin(c.angle + Math.PI / 2) * s * 10,
          life: 3.5, max: 3.5,
        });
      }
    }
    p.x = c.x;
    p.y = c.y;
    p.angle = c.angle;
    world.audio && world.audio.engineUpdate(c.speed, true);
    // drive-by
    p.fireCd -= dt;
    if (input.firing() && p.fireCd <= 0) {
      p.fireCd = PLAYER.fireCooldown * 1.6;
      const a = c.angle + (ax ? ax * 0.5 : 0) + Math.PI / 2;
      world.bullets.push({ x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * PLAYER.bulletSpeed, vy: Math.sin(a) * PLAYER.bulletSpeed, life: 0.7, from: 'player' });
      world.audio && world.audio.shot();
      raiseHeat(world, world.wanted < 1 ? 1 : 0, world.wanted < 1 ? 'Shots fired!' : null);
    }
    // exit car
    if (input.takeActions() & 1) {
      c.role = 'parked';
      c.speed = 0;
      p.car = null;
      p.onFoot = true;
      p.x = c.x + Math.cos(c.angle + Math.PI / 2) * 30;
      p.y = c.y + Math.sin(c.angle + Math.PI / 2) * 30;
      if (!isWalkable(world, p.x, p.y)) { p.x = c.x; p.y = c.y; }
      world.audio && world.audio.door();
      world.audio && world.audio.engineUpdate(0, false);
    }
  }

  // pickups
  for (const k of world.pickups) {
    if (k.taken) continue;
    if (dist2(p.x, p.y, k.x, k.y) < 30 * 30) {
      k.taken = true;
      if (k.kind === 'cash') {
        world.money += k.value;
        world.audio && world.audio.cash();
        addText(world, k.x, k.y - 16, `+$${k.value}`, COLORS.gold);
      } else {
        p.hp = Math.min(p.maxHp, p.hp + k.value);
        world.audio && world.audio.pickup();
        addText(world, k.x, k.y - 16, `+${k.value} HP`, COLORS.green);
      }
    }
  }
  // run over pedestrians
  if (!p.onFoot && Math.abs(p.car.speed) > 90) {
    for (const ped of world.peds) {
      if (ped.dead) continue;
      if (dist2(p.x, p.y, ped.x, ped.y) < 26 * 26) {
        killPed(world, ped, true);
        raiseHeat(world, 1, 'Hit and run!');
      }
    }
  }
}

function damageCar(world, car, amount) {
  car.hp -= amount;
  if (car.hp <= 0 && !car.burn) {
    car.burn = 0.01;
    world.audio && world.audio.explosion();
  }
}

function killPed(world, ped, silent) {
  ped.dead = true;
  ped.deadT = 0;
  world.stats.kills++;
  burst(world, ped.x, ped.y, '#a03028', 8, 90);
  if (!silent) addText(world, ped.x, ped.y - 14, 'Wasted civilian', '#e04f3f');
}

// --- traffic ---

function updateTraffic(world, dt) {
  const p = world.player;
  for (const c of world.cars) {
    if (c.burn) {
      c.burn += dt;
      if (Math.random() < dt * 8) burst(world, c.x + (Math.random() - 0.5) * 20, c.y + (Math.random() - 0.5) * 20, Math.random() < 0.5 ? '#e08a2f' : '#666', 2, 60);
      if (c.burn > 1.6) {
        c.burn = -999;
        burst(world, c.x, c.y, '#e04f3f', 26, 220);
        if (dist2(p.x, p.y, c.x, c.y) < 70 * 70) hurtPlayer(world, 35);
        for (const ped of world.peds) {
          if (!ped.dead && dist2(ped.x, ped.y, c.x, c.y) < 60 * 60) killPed(world, ped, true);
        }
      }
      continue;
    }
    if (c.role === 'parked') continue;
    if (c.role === 'wreck') continue;
    // traffic AI: drive along its lane, stop for cars ahead, panic when heat high
    const tx = Math.round(c.x / TILE);
    const ty = Math.round(c.y / TILE);
    const gx = tx % 6;
    const gy = ty % 6;
    // at an intersection (both coords on a road band) commit to a turning choice
    let horiz = gy === 0 || gy === 1;
    if (!c.turnChoice) {
      const cross = (horiz && (gx === 0 || gx === 1)) || (!horiz && (gy === 0 || gy === 1));
      if (cross && (gx === 0 || gy === 0)) {
        // entering an intersection: mostly straight, sometimes turn onto the crossing road
        c.turnChoice = Math.random() < 0.68 ? 'straight' : (Math.random() < 0.5 ? 'left' : 'right');
        c.turnT = 1.4;
      }
    }
    let want;
    if (c.turnChoice && c.turnChoice !== 'straight' && c.turnT > 0) {
      c.turnT -= dt;
      const base = horiz ? (gx === 1 ? Math.PI : 0) : (gy === 1 ? -Math.PI / 2 : Math.PI / 2);
      want = base + (c.turnChoice === 'left' ? Math.PI / 2 : -Math.PI / 2);
    } else {
      if (c.turnT !== undefined && c.turnT <= 0) c.turnChoice = null;
      want = horiz ? (gx === 0 ? 0 : Math.PI) : (gy === 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    if (world.wanted >= 3 && dist2(c.x, c.y, p.x, p.y) < 200 * 200) {
      // flee
      want = Math.atan2(c.y - p.y, c.x - p.x);
    }
    let d = want - c.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    c.angle += clamp(d, -2.5 * dt, 2.5 * dt);
    // obstacle ahead?
    const ahead = 46 + Math.abs(c.speed) * 0.35;
    const lx = c.x + Math.cos(c.angle) * ahead;
    const ly = c.y + Math.sin(c.angle) * ahead;
    let blocked = !isDrivable(world, lx, ly);
    if (!blocked) {
      for (const o of world.cars) {
        if (o === c || o.burn || o.role === 'wreck') continue;
        if (dist2(lx, ly, o.x, o.y) < 30 * 30) { blocked = true; break; }
      }
    }
    if (!blocked && p.onFoot && dist2(lx, ly, p.x, p.y) < 26 * 26) blocked = true;
    // stuck honking: blocked for a while means a polite (then impatient) honk
    if (blocked && Math.abs(c.speed) < 12) {
      c.stuckT = (c.stuckT || 0) + dt;
      c.honk -= dt;
      if (c.stuckT > 1.2 && c.honk <= 0) {
        c.honk = 2.5 + Math.random() * 2;
        if (dist2(c.x, c.y, p.x, p.y) < 700 * 700) world.audio && world.audio.honk();
      }
    } else c.stuckT = 0;
    const target = blocked ? 0 : (world.wanted >= 3 ? TRAFFIC_SPEED * 1.5 : TRAFFIC_SPEED);
    c.speed += clamp(target - c.speed, -260 * dt, 130 * dt);
    c.x += Math.cos(c.angle) * c.speed * dt;
    c.y += Math.sin(c.angle) * c.speed * dt;
    c.x = clamp(c.x, TILE, WORLD_W - TILE);
    c.y = clamp(c.y, TILE, WORLD_H - TILE);
    // player rams traffic
    if (!p.onFoot && p.car && p.car !== c && dist2(p.x, p.y, c.x, c.y) < 30 * 30 && Math.abs(p.car.speed) > 140) {
      damageCar(world, c, 30);
      p.car.speed *= 0.5;
      raiseHeat(world, 1, 'Reckless driving!');
    }
  }
  // recycle far-away traffic near the player to keep streets alive
  const alive = world.cars.filter((c) => c.role === 'traffic' && !c.burn && c.role !== 'wreck');
  for (const c of world.cars) {
    if (c.role !== 'traffic' || c.burn || c.role === 'wreck') continue;
    if (dist2(c.x, c.y, p.x, p.y) > 1400 * 1400) {
      // respawn near player edge
      const ang = Math.random() * Math.PI * 2;
      const nx = clamp(p.x + Math.cos(ang) * 900, TILE, WORLD_W - TILE);
      const ny = clamp(p.y + Math.sin(ang) * 900, TILE, WORLD_H - TILE);
      if (isDrivable(world, nx, ny)) {
        c.x = nx; c.y = ny;
        c.angle = Math.random() < 0.5 ? 0 : Math.PI / 2;
        c.speed = TRAFFIC_SPEED;
      }
    }
  }
}

// --- pedestrians ---

function updatePeds(world, dt) {
  const p = world.player;
  for (const ped of world.peds) {
    if (ped.dead) { ped.deadT += dt; continue; }
    // panic when heat high or gunshots near
    const scare = world.wanted >= 1 || (world.bullets.length > 0 && dist2(ped.x, ped.y, p.x, p.y) < 260 * 260);
    if (scare && ped.panic <= 0) ped.panic = 3 + Math.random() * 3;
    if (ped.panic > 0) {
      ped.panic -= dt;
      const away = Math.atan2(ped.y - p.y, ped.x - p.x);
      ped.angle = away + Math.sin(world.time * 6 + ped.phase) * 0.6;
      // also flee any car closing fast, not just the player
      for (const c of world.cars) {
        if (c.burn || c.role === 'wreck' || c.role === 'parked') continue;
        if (Math.abs(c.speed) > 80 && dist2(c.x, c.y, ped.x, ped.y) < 130 * 130) {
          ped.angle = Math.atan2(ped.y - c.y, ped.x - c.x);
          break;
        }
      }
      const s = 70;
      const nx = ped.x + Math.cos(ped.angle) * s * dt;
      const ny = ped.y + Math.sin(ped.angle) * s * dt;
      if (isWalkable(world, nx, ped.y)) ped.x = nx;
      if (isWalkable(world, ped.x, ny)) ped.y = ny;
    } else {
      // sidewalk life: prefer to stay on walkable tiles, straighten toward the
      // nearest sidewalk axis and cross the road occasionally
      if (Math.random() < dt * 0.25) ped.jaywalk = 2 + Math.random() * 2;
      const tx2 = Math.floor(ped.x / TILE);
      const ty2 = Math.floor(ped.y / TILE);
      const onSidewalk = isWalkable(world, ped.x, ped.y);
      if (ped.jaywalk > 0) {
        ped.jaywalk -= dt;
        // cut straight across, ignoring the sidewalk guidance
      } else if (onSidewalk && Math.random() < dt * 1.5) {
        // snap gently toward walking along the sidewalk axis
        const txMod = tx2 % 6;
        const tyMod = ty2 % 6;
        const walkingX = Math.abs(Math.cos(ped.angle)) > Math.abs(Math.sin(ped.angle));
        if (tyMod >= 2 && tyMod < 6 && !walkingX) ped.angle = Math.random() < 0.5 ? 0 : Math.PI;
        else if (txMod >= 2 && txMod < 6 && walkingX) ped.angle = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (Math.random() < dt * 0.6) ped.angle += (Math.random() - 0.5) * 1.6;
      const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
      const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
      if (isWalkable(world, nx, ny) || ped.jaywalk > 0) { ped.x = nx; ped.y = ny; }
      else ped.angle += Math.PI / 2 + Math.random();
    }
    ped.x = clamp(ped.x, TILE, WORLD_W - TILE);
    ped.y = clamp(ped.y, TILE, WORLD_H - TILE);
    ped.phase += dt * (ped.panic > 0 ? 14 : 6);
  }
  // cull corpses far away
  world.peds = world.peds.filter((ped) => !ped.dead || ped.deadT < 20);
  if (world.peds.length < COUNTS.peds * 0.6) spawnPed(world, world.rand);
}

// --- cops ---

function raiseHeat(world, amount, message) {
  world.heat = Math.min(6, world.heat + amount);
  world.heatCool = 0;
  if (message) addText(world, world.player.x, world.player.y - 26, message, '#e04f3f');
  recomputeWanted(world);
}

function recomputeWanted(world) {
  const stars = world.heat >= 5 ? 5 : world.heat >= 3.5 ? 4 : world.heat >= 2.5 ? 3 : world.heat >= 1.5 ? 2 : world.heat >= 0.5 ? 1 : 0;
  if (stars > world.wanted) {
    world.audio && world.audio.sirenSet(true);
  } else if (stars === 0 && world.wanted > 0) {
    world.audio && world.audio.sirenSet(false);
  }
  world.wanted = stars;
}

function updateHeat(world, dt) {
  if (world.heat > 0) {
    world.heatCool += dt;
    if (world.heatCool > 9 && world.cops.length === 0) {
      world.heat = Math.max(0, world.heat - dt * 0.35);
      world.heatCool = 8.6;
      if (world.heat <= 0) recomputeWanted(world);
    }
  }
  if (world.mission && world.mission.kind === 'survive' && world.wanted >= 2) {
    world.surviveTimer += dt;
    if (world.surviveTimer >= 40) completeMission(world);
  }
}

function spawnCop(world) {
  // spawn on a road just off-screen from the player
  const p = world.player;
  for (let tries = 0; tries < 50; tries++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 500 + Math.random() * 350;
    const x = clamp(p.x + Math.cos(ang) * d, TILE, WORLD_W - TILE);
    const y = clamp(p.y + Math.sin(ang) * d, TILE, WORLD_H - TILE);
    if (!isDrivable(world, x, y)) continue;
    const car = makeCar(x, y, Math.atan2(p.y - y, p.x - x), '#20242c', 'cop');
    world.cops.push(car);
    world.cars.push(car);
    // two officers on foot
    for (let i = 0; i < 2; i++) {
      world.cops.push({
        x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30,
        angle: 0, hp: 40, fireCd: 1 + Math.random(), onFoot: true, phase: Math.random() * 6,
      });
    }
    return;
  }
}

function updateCops(world, dt) {
  const p = world.player;
  const wantCops = world.wanted > 0 ? Math.min(6, world.wanted * 2) : 0;
  const cars = world.cops.filter((c) => c.role === 'cop');
  if (cars.length < wantCops && Math.random() < dt * 0.8) spawnCop(world);
  // roadblocks at 4-5 stars: park two cop cars across the road ahead of the player
  if (world.wanted >= 4 && !world.roadblockCd) world.roadblockCd = 0;
  if (world.wanted >= 4) {
    world.roadblockCd -= dt;
    if (world.roadblockCd <= 0 && cars.length >= 2) {
      world.roadblockCd = 14;
      const pcar = p.onFoot ? null : p.car;
      if (pcar && Math.abs(pcar.speed) > 60) {
        const ahead = 620;
        const bx = p.x + Math.cos(pcar.angle) * ahead;
        const by = p.y + Math.sin(pcar.angle) * ahead;
        if (isDrivable(world, bx, by)) {
          const ang = pcar.angle;
          for (let i = 0; i < 2; i++) {
            const off = (i === 0 ? -1 : 1) * 22;
            const rx = bx + Math.cos(ang + Math.PI / 2) * off;
            const ry = by + Math.sin(ang + Math.PI / 2) * off;
            if (!isDrivable(world, rx, ry)) continue;
            const rb = makeCar(rx, ry, ang + Math.PI / 2, '#20242c', 'cop');
            rb.roadblock = true;
            world.cops.push(rb);
            world.cars.push(rb);
          }
          addText(world, p.x, p.y - 40, 'ROADBLOCK AHEAD!', '#e04f3f');
        }
      }
    }
  } else if (world.wanted < 3) {
    // dissolve roadblocks when the heat drops
    for (const c of world.cops) if (c.roadblock) c.despawn = true;
    world.cars = world.cars.filter((c) => !c.despawn);
    world.cops = world.cops.filter((c) => c.role === 'cop' && !c.despawn);
    if (world.wanted < 4) world.roadblockCd = 0;
  }
  if (world.wanted === 0) {
    // cops give up and drive off
    for (const c of world.cops) {
      if (c.role === 'cop' && dist2(c.x, c.y, p.x, p.y) > 600 * 600) c.despawn = true;
    }
    world.cars = world.cars.filter((c) => !c.despawn);
    world.cops = world.cops.filter((c) => c.role === 'cop' && !c.despawn);
  }

  for (const cop of world.cops) {
    if (cop.role === 'cop') {
      // parked roadblock cars hold position
      if (cop.roadblock) { cop.speed = 0; continue; }
      // police car: chase with pursuit prediction; PIT when alongside; roadblocks at 4-5 stars
      const d = Math.hypot(p.x - cop.x, p.y - cop.y);
      // predict where the player will be: lead the target by their velocity
      const lead = p.onFoot ? 0 : Math.min(0.9, d / 420);
      let aimX = p.x;
      let aimY = p.y;
      if (!p.onFoot && p.car) {
        aimX += (p.car.vx || Math.cos(p.car.angle) * p.car.speed) * lead;
        aimY += (p.car.vy || Math.sin(p.car.angle) * p.car.speed) * lead;
      }
      let da = Math.atan2(aimY - cop.y, aimX - cop.x) - cop.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      cop.angle += clamp(da, -3 * dt, 3 * dt);
      // PIT maneuver: when alongside and roughly parallel, nudge into the player's flank
      if (!p.onFoot && p.car && world.wanted >= 3) {
        const along = Math.abs(Math.cos(cop.angle - p.car.angle));
        if (d < 52 && along < 0.45 && Math.abs(cop.speed) > 120) {
          const side = Math.sign(Math.sin(cop.angle - p.car.angle)) || 1;
          cop.x += Math.cos(cop.angle + Math.PI / 2) * side * 90 * dt;
          cop.y += Math.sin(cop.angle + Math.PI / 2) * side * 90 * dt;
        }
      }
      const target = d > 90 ? COP_BASE_SPEED + world.wanted * 22 : 0;
      cop.speed += clamp(target - cop.speed, -400 * dt, 220 * dt);
      const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
      const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
      if (isDrivable(world, nx, ny)) cop.x = nx;
      else cop.speed *= -0.4;
      if (isDrivable(world, cop.x, ny)) cop.y = ny;
      else cop.speed *= -0.4;
      // ram damage to player's car
      if (!p.onFoot && p.car && dist2(cop.x, cop.y, p.x, p.y) < 34 * 34 && Math.abs(cop.speed) > 100) {
        damageCar(world, p.car, 8);
        cop.speed *= 0.3;
        hurtPlayer(world, 4);
      }
      // deploy foot cops when close and player on foot
      if (p.onFoot && d < 130 && cop.footCd !== true) {
        cop.footCd = true;
        for (let i = 0; i < 2; i++) {
          world.cops.push({ x: cop.x + (Math.random() - 0.5) * 30, y: cop.y + (Math.random() - 0.5) * 30, angle: 0, hp: 40, fireCd: 1.2 + Math.random(), onFoot: true, phase: Math.random() * 6 });
        }
      }
    } else {
      // foot cop: approach, shoot
      const d = Math.hypot(p.x - cop.x, p.y - cop.y);
      cop.angle = Math.atan2(p.y - cop.y, p.x - cop.x);
      if (d > 120) {
        const s = 95;
        const nx = cop.x + Math.cos(cop.angle) * s * dt;
        const ny = cop.y + Math.sin(cop.angle) * s * dt;
        if (isWalkable(world, nx, ny) || isDrivable(world, nx, ny)) { cop.x = nx; cop.y = ny; }
      }
      cop.fireCd -= dt;
      if (cop.fireCd <= 0 && d < 300) {
        cop.fireCd = 1.4 - Math.min(0.8, world.wanted * 0.15) + Math.random() * 0.4;
        const spread = (Math.random() - 0.5) * 0.18;
        world.bullets.push({ x: cop.x + Math.cos(cop.angle) * 12, y: cop.y + Math.sin(cop.angle) * 12, vx: Math.cos(cop.angle + spread) * 480, vy: Math.sin(cop.angle + spread) * 480, life: 0.9, from: 'cop' });
        world.audio && world.audio.shot();
      }
      if (d < 26) hurtPlayer(world, 12 * dt * 3);
    }
  }
  // busted check: cop car close while player on foot and slow — with a grace period
  if (world.wanted > 0 && p.onFoot) {
    let close = false;
    for (const c of world.cops) {
      if (c.role === 'cop' && dist2(c.x, c.y, p.x, p.y) < 42 * 42) { close = true; break; }
    }
    if (close) {
      world.bustedGrace = (world.bustedGrace || 0) + dt;
      if (world.bustedGrace >= 0.8) {
        world.busted = true;
        world.deadTimer = 0;
        world.audio && world.audio.sirenSet(false);
        world.events.push(EV_BUSTED);
      }
    } else world.bustedGrace = 0;
  }
  // foot cops die when shot
  world.cops = world.cops.filter((c) => c.role === 'cop' || c.hp > 0);
}

function hurtPlayer(world, amount) {
  const p = world.player;
  p.hp -= amount;
  if (world.mission) world.missionDamage = (world.missionDamage || 0) + amount;
  world.audio && world.audio.hurt();
  if (p.hp <= 0 && !world.dead && !world.busted) {
    world.dead = true;
    world.deadTimer = 0;
    world.audio && world.audio.sirenSet(false);
    world.audio && world.audio.engineUpdate(0, false);
    world.events.push(EV_PLAYER_DEAD);
  }
}

// --- bullets ---

function updateBullets(world, dt) {
  const p = world.player;
  for (const b of world.bullets) {
    b.life -= dt;
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;
    b.x = nx;
    b.y = ny;
    // hit buildings
    const tx = Math.floor(nx / TILE);
    const ty = Math.floor(ny / TILE);
    if (tx < 0 || ty < 0 || tx >= world.mw || ty >= world.mh || world.tiles[ty * world.mw + tx] === T_BUILDING) {
      b.life = 0;
      burst(world, nx, ny, '#ccc', 3, 60);
      continue;
    }
    if (b.from === 'player') {
      for (const cop of world.cops) {
        if (cop.role === 'cop') continue;
        if (dist2(b.x, b.y, cop.x, cop.y) < 16 * 16) {
          cop.hp -= 20;
          b.life = 0;
          burst(world, cop.x, cop.y, '#a03028', 5, 80);
          if (cop.hp <= 0) {
            world.stats.kills++;
            raiseHeat(world, 1, 'Cop down!');
            const idx = world.cops.indexOf(cop);
            if (idx >= 0) world.cops.splice(idx, 1);
          }
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const c of world.cars) {
        if (c.role === 'player' || c.burn || c.role === 'wreck') continue;
        if (dist2(b.x, b.y, c.x, c.y) < 24 * 24) {
          damageCar(world, c, 18);
          b.life = 0;
          if (c.role === 'traffic') raiseHeat(world, 0.5, null);
          break;
        }
      }
      if (b.life <= 0) continue;
      for (const ped of world.peds) {
        if (ped.dead) continue;
        if (dist2(b.x, b.y, ped.x, ped.y) < 14 * 14) {
          killPed(world, ped, true);
          raiseHeat(world, 1, 'Shots fired!');
          b.life = 0;
          break;
        }
      }
    } else {
      // cop bullets hit the player
      if (dist2(b.x, b.y, p.x, p.y) < 15 * 15) {
        b.life = 0;
        hurtPlayer(world, 9);
      }
      // and the player's car
      if (!p.onFoot && p.car && dist2(b.x, b.y, p.x, p.y) < 22 * 22) {
        b.life = 0;
        damageCar(world, p.car, 5);
        hurtPlayer(world, 3);
      }
    }
  }
  world.bullets = world.bullets.filter((b) => b.life > 0);
}

function updateParticles(world, dt) {
  for (const pt of world.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.92;
    pt.vy *= 0.92;
  }
  world.particles = world.particles.filter((pt) => pt.life > 0);
}

function updateSkidMarks(world, dt) {
  if (world.skidMarks.length === 0) return;
  for (const s of world.skidMarks) s.life -= dt;
  world.skidMarks = world.skidMarks.filter((s) => s.life > 0);
}

// --- districts ---

function districtName(world, tx, ty) {
  const col = Math.min(2, Math.floor((tx / world.mw) * 3));
  const row = Math.min(2, Math.floor((ty / world.mh) * 3));
  return DISTRICTS[row * 3 + col];
}

function updateDistrict(world, dt) {
  const p = world.player;
  const name = districtName(world, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  if (name !== world.district) {
    world.district = name;
    world.districtT = 3.4;
  }
  if (world.districtT > 0) world.districtT -= dt;
}

// --- missions ---

export function startMission(world) {
  if (world.mission || world.cityTaken) return;
  const m = MISSIONS[world.missionsDone % MISSIONS.length];
  const p = world.player;
  const mission = { ...m, targets: [], started: world.time };
  if (m.kind === 'collect') {
    for (let i = 0; i < m.count; i++) {
      const ang = (i / m.count) * Math.PI * 2 + world.rand.next();
      const d = 420 + world.rand.range(0, 260);
      const x = clamp(p.x + Math.cos(ang) * d, 2 * TILE, WORLD_W - 2 * TILE);
      const y = clamp(p.y + Math.sin(ang) * d, 2 * TILE, WORLD_H - 2 * TILE);
      mission.targets.push({ x, y, got: false });
    }
  } else if (m.kind === 'wreck') {
    for (let i = 0; i < m.count; i++) {
      const ang = (i / m.count) * Math.PI * 2 + 1.1;
      const d = 380 + world.rand.range(0, 240);
      const x = clamp(p.x + Math.cos(ang) * d, 2 * TILE, WORLD_W - 2 * TILE);
      const y = clamp(p.y + Math.sin(ang) * d, 2 * TILE, WORLD_H - 2 * TILE);
      if (isDrivable(world, x, y)) {
        const gang = makeCar(x, y, world.rand.range(0, Math.PI * 2), '#7a2fa0', 'traffic');
        gang.gang = true;
        world.cars.push(gang);
        mission.targets.push(gang);
      }
    }
  }
  world.mission = mission;
  world.missionDamage = 0;
  world.surviveTimer = 0;
  world.dialog = m.dialog;
  world.dialogT = 6.5;
  world.audio && world.audio.mission();
  addText(world, p.x, p.y - 40, 'MISSION ' + (world.missionsDone + 1) + ': ' + m.brief, COLORS.gold);
}

function completeMission(world) {
  if (!world.mission) return;
  // economy: rewards scale with progress so later jobs pay meaningfully more
  const progressMult = 1 + world.missionsDone * 0.18;
  let reward = Math.round(world.mission.reward * progressMult);
  // streak bonus: finish the job without taking damage for a clean-run bonus
  if (world.missionDamage === 0) {
    const bonus = Math.round(reward * 0.25);
    reward += bonus;
    addText(world, world.player.x, world.player.y - 58, `CLEAN RUN +$${bonus}`, COLORS.gold);
  } else {
    world.missionDamage = 0;
  }
  world.money += reward;
  world.missionsDone++;
  world.mission = null;
  world.audio && world.audio.mission();
  world.audio && world.audio.cash();
  if (world.missionsDone >= MISSIONS.length) {
    world.cityTaken = true;
    world.dialog = 'Manny: "The whole Coast is ours, Johnny. CITY TAKEN."';
    world.dialogT = 999;
    addText(world, world.player.x, world.player.y - 40, 'CITY TAKEN — the Coast belongs to you', COLORS.gold);
  } else {
    addText(world, world.player.x, world.player.y - 40, `MISSION COMPLETE +$${reward}`, COLORS.green);
  }
}

function updateMission(world, dt) {
  const m = world.mission;
  if (!m) return;
  const p = world.player;
  if (m.kind === 'collect') {
    for (const t of m.targets) {
      if (!t.got && dist2(p.x, p.y, t.x, t.y) < 34 * 34) {
        t.got = true;
        world.audio && world.audio.pickup();
        addText(world, t.x, t.y - 14, 'Drop secured', COLORS.gold);
      }
    }
    if (m.targets.every((t) => t.got)) completeMission(world);
  } else if (m.kind === 'wreck') {
    const left = m.targets.filter((c) => !c.burn && c.role !== 'wreck' && c.hp > 0);
    if (left.length === 0) completeMission(world);
    else if (left.length < m.targets.length) {
      // mark wrecked ones so they stop counting
      for (const c of m.targets) {
        if (c.hp <= 0 && c.role !== 'wreck') { c.role = 'wreck'; }
      }
    }
  } else if (m.kind === 'steal') {
    if (m.startSteals === undefined) m.startSteals = world.stats.steals;
    if (world.stats.steals > m.startSteals) {
      addText(world, p.x, p.y - 20, 'Nice ride — now lose the stars', COLORS.gold);
      completeMission(world);
    }
  }
  // survive handled in updateHeat
}
