// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. Screens: title, play, paused, busted/wasted (over), with save + best haul in
// localStorage.
import { SAVE_KEY, STEP } from './config.js';
import { createWorld, EV_BUSTED, EV_PLAYER_DEAD, startMission } from './world.js';
import { createInput, ACT_CONFIRM, ACT_NEWGAME, ACT_PAUSE, ACT_ENTER } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261118;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const input = createInput();
const renderer = createRenderer(canvas);
const audio = createAudio();
world.audio = audio;
world.audioMuted = false;

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null) return null;
    return {
      money: Number(s.money) || 0,
      missionsDone: Number(s.missionsDone) || 0,
      heat: Number(s.heat) || 0,
      wanted: Number(s.wanted) || 0,
      stats: s.stats && typeof s.stats === 'object' ? s.stats : { kills: 0, steals: 0, deliveries: 0 },
      player: s.player && typeof s.player === 'object' ? s.player : null,
      missionSeed: Number(s.missionSeed) || 0,
    };
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    const p = world.player;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: world.money,
      missionsDone: world.missionsDone,
      heat: world.heat,
      wanted: world.wanted,
      stats: world.stats,
      player: {
        x: p.x, y: p.y, angle: p.angle, onFoot: p.onFoot, hp: p.hp,
        carX: p.car ? p.car.x : null, carY: p.car ? p.car.y : null, carAngle: p.car ? p.car.angle : null,
        carHp: p.car ? p.car.hp : null, carColor: p.car ? p.car.color : null,
      },
      missionSeed: world.missionsDone,
    }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

let save = readSave();
/** The best haul ever banked, shown on the title and over screens. */
let best = save ? save.money : 0;

/** Continue a saved run: restore money, stats and the player's position and car. */
function restore() {
  if (!save) return false;
  world.money = save.money;
  world.missionsDone = save.missionsDone;
  world.heat = save.heat;
  world.wanted = save.wanted;
  world.stats = save.stats;
  const p = world.player;
  const sp = save.player;
  if (sp) {
    p.x = sp.x;
    p.y = sp.y;
    p.angle = sp.angle;
    p.onFoot = sp.onFoot;
    p.hp = Math.max(30, sp.hp ?? p.maxHp);
    if (sp.carX !== null && sp.carX !== undefined && !p.onFoot) {
      const car = world.cars.find((c) => Math.abs(c.x - sp.carX) < 40 && Math.abs(c.y - sp.carY) < 40);
      if (car) {
        car.role = 'player';
        car.hp = sp.carHp ?? car.hp;
        car.color = sp.carColor ?? car.color;
        car.angle = sp.carAngle ?? car.angle;
        p.car = car;
      } else {
        p.onFoot = true;
      }
    }
  }
  return true;
}

function announce(msg) {
  if (status) status.textContent = msg;
}

// The shot autopilot: drive toward the current mission target, else the nearest pickup.
const pilotInput = {
  axes: () => {
    const w = world;
    const p = w.player;
    let target = null;
    if (w.mission) {
      for (const t of w.mission.targets) {
        if (w.mission.kind === 'collect' && t.got) continue;
        if (w.mission.kind === 'wreck' && (t.burn || t.role === 'wreck')) continue;
        if (!target) target = t;
      }
    }
    if (!target) {
      let bd = Infinity;
      for (const k of w.pickups) {
        if (k.taken) continue;
        const d = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
        if (d < bd) { bd = d; target = k; }
      }
    }
    if (!target) return { ax: 0, ay: -1 };
    if (p.onFoot) {
      return { ax: Math.sign(target.x - p.x), ay: Math.sign(target.y - p.y) };
    }
    const want = Math.atan2(target.y - p.y, target.x - p.x);
    let da = want - p.car.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return { ax: Math.abs(da) > 0.06 ? Math.sign(da) : 0, ay: -1 };
  },
  firing: () => false,
  takeActions: () => 0,
};

function runShot(name) {
  // Staged frames for the screenshots: play the real simulation forward from a fresh
  // world with a scripted autopilot, so the frame is what a real session looks like.
  const p = world.player;
  // seat the player in the nearest car so every scene is a driving scene
  let car = null;
  let bd = Infinity;
  for (const c of world.cars) {
    if (c.role === 'cop') continue;
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bd) { bd = d; car = c; }
  }
  if (car) {
    car.role = 'player';
    p.car = car;
    p.onFoot = false;
  }
  const seconds = name === 'start' ? 6 : name === 'late' ? 200 : name === 'end' ? 400 : name === 'heat' ? 20 : 55;
  if (name === 'heat') {
    world.heat = 3.2;
    world.wanted = 3;
  } else if (name === 'late') {
    world.dayT = 0.9; // night
    world.money = 2480;
    world.missionsDone = 3;
  } else if (name === 'end') {
    world.dayT = 0.86;
    world.money = 6180;
    world.missionsDone = 6;
    world.cityTaken = true;
  } else if (name !== 'start') {
    world.heat = 1.6;
    world.wanted = 2;
  }
  startMission(world);
  if (name === 'end') world.cityTaken = true;
  for (let i = 0; i < seconds / STEP; i++) {
    stepWorld(world, pilotInput, STEP);
  }
  return { screen: SCREEN_PLAY, best: world.money };
}

// local import of step to avoid a cycle at module-eval time
import { step as stepWorld } from './world.js';

function runGame() {
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  function frame(now) {
    const dt = Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    const actions = input.takeActions();

    if (screen === SCREEN_TITLE) {
      audio.resume();
      if (actions & ACT_CONFIRM) {
        if (save && !restore()) save = null;
        screen = SCREEN_PLAY;
        announce('Welcome to Palm Coast. Follow the gold markers.');
      } else if (actions & ACT_NEWGAME) {
        clearSave();
        save = null;
        world.money = 0;
        world.missionsDone = 0;
        world.heat = 0;
        world.wanted = 0;
        world.stats = { kills: 0, steals: 0, deliveries: 0 };
        screen = SCREEN_PLAY;
        announce('A fresh start on the Coast.');
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACT_PAUSE) {
        screen = SCREEN_PAUSED;
      } else {
        accumulator += dt;
        while (accumulator >= STEP) {
          const events = stepWorld(world, input, STEP);
          accumulator -= STEP;
          if (events.includes(EV_PLAYER_DEAD) || events.includes(EV_BUSTED)) {
            screen = SCREEN_OVER;
            best = Math.max(best, world.money);
            break;
          }
        }
        saveTimer += dt;
        if (saveTimer > 5) {
          saveTimer = 0;
          writeSave();
        }
        if (!world.mission && world.wanted < 2) startMission(world);
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & ACT_PAUSE) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_OVER) {
      if (actions & ACT_CONFIRM) {
        // keep the money, respawn
        world.dead = false;
        world.busted = false;
        world.player.hp = world.player.maxHp;
        world.player.onFoot = true;
        world.player.car = null;
        world.heat = 0;
        world.wanted = 0;
        world.cops.length = 0;
        world.cars = world.cars.filter((c) => c.role !== 'cop');
        writeSave();
        screen = SCREEN_PLAY;
        announce('Back on your feet.');
      } else if (actions & ACT_NEWGAME) {
        clearSave();
        save = null;
        const fresh = createWorld(seed + 1);
        Object.assign(world, {
          tiles: fresh.tiles, buildings: fresh.buildings, trees: fresh.trees, blocks: fresh.blocks,
          cars: fresh.cars, peds: fresh.peds, cops: fresh.cops, pickups: fresh.pickups,
          money: 0, missionsDone: 0, heat: 0, wanted: 0, mission: null,
          stats: { kills: 0, steals: 0, deliveries: 0 }, dead: false, busted: false, deadTimer: 0,
        });
        world.player.x = fresh.player.x;
        world.player.y = fresh.player.y;
        screen = SCREEN_PLAY;
        announce('A fresh start on the Coast.');
      }
    }

    audio.sirenSet(world.wanted > 0 && screen === SCREEN_PLAY);
    renderer.draw(world, screen, best);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function paintShot(scene) {
  let frames = 0;
  function paint() {
    renderer.draw(world, scene.screen, scene.best);
    frames++;
    if (frames < 8) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      const el = document.createElement('canvas');
      el.id = '__ready';
      el.style.display = 'none';
      document.body.appendChild(el);
    }
  }
  requestAnimationFrame(paint);
}

if (shot) {
  const scene = runShot(shot);
  paintShot(scene);
} else {
  runGame();
}
