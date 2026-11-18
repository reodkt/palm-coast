// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// The renderer: one canvas, one draw per frame. Draws the city tiles, then shadows,
// then everything that moves, then the HUD (minimap, wanted stars, cash, HP, mission),
// then the screens (title, paused, busted, wasted). Everything is flat-colour 2D.
import { BLOCK_PALETTES, CAR, COLORS, COP_LIGHTS, DISTRICTS, PLAYER, TILE, T_BUILDING, T_LOT, T_PARK, T_ROAD, T_SIDEWALK, WORLD_H, WORLD_W } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const VIEW_W = 1280;
const VIEW_H = 720;

const SKIN = ['#e8b88a', '#c98d5f', '#8c5a3a', '#f0c8a0'];
const CAR_W = 24;
const CAR_L = 44;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const state = {
    booms: [],            // explosion FX: {x, y, t0} in world coords
    burnPrev: new Map(),  // car -> previous burn value, to detect detonation frames
    glowLights: [],       // street lamp positions (screen coords) lit this frame
    prevHp: null,         // player hp last frame, for the red damage flash
    hurtT: 0,             // seconds left on the damage flash
    shake: 0,             // screenshake magnitude in px
    fogW: 0, fog: null,   // minimap fog-of-war grid (explored chunk booleans)
  };
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  ctx.imageSmoothingEnabled = false;

  // --- explosion FX: register a boom when a car crosses from burning to destroyed ---
  function updateBooms(world, cam, time) {
    for (const c of world.cars) {
      const prev = state.burnPrev.get(c);
      if (c.burn === -999 && prev !== undefined && prev !== -999) {
        // detonation frame: flash + expanding shockwave + debris spray
        state.booms.push({ x: c.x, y: c.y, t0: time });
        state.shake = Math.max(state.shake, 10);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 90 + Math.random() * 190;
          world.particles.push({
            x: c.x, y: c.y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 0.5 + Math.random() * 0.6,
            color: Math.random() < 0.5 ? '#f5c542' : Math.random() < 0.5 ? '#e05a2f' : '#3c4046',
            size: 2 + Math.random() * 4,
          });
        }
      }
      state.burnPrev.set(c, c.burn);
    }
    for (const b of state.booms) b.age = time - b.t0;
    state.booms = state.booms.filter((b) => b.age < 0.7);
  }

  function drawBooms(world, cam) {
    for (const b of state.booms) {
      const x = b.x - cam.x;
      const y = b.y - cam.y;
      const a = b.age;
      // shockwave ring: expands and fades over ~0.7s
      const r = 14 + (a / 0.7) * 150;
      ctx.strokeStyle = `rgba(255, 240, 200, ${Math.max(0, 0.85 * (1 - a / 0.7))})`;
      ctx.lineWidth = 4 * (1 - a / 0.7) + 1;
      circle(x, y, r, null, null, 0);
      ctx.stroke();
      // white-hot flash in the first 100ms
      if (a < 0.12) {
        ctx.fillStyle = `rgba(255, 250, 230, ${0.9 * (1 - a / 0.12)})`;
        circle(x, y, 44, null, null, 0);
        ctx.fill();
      }
      // warm glow decaying
      ctx.fillStyle = `rgba(240, 150, 60, ${Math.max(0, 0.35 * (1 - a / 0.5))})`;
      circle(x, y, 30 + a * 30, null, null, 0);
      ctx.fill();
    }
  }

  // --- tire smoke: puffs behind the player while skidding (car drifting fast turns) ---
  function drawSmoke(world, cam, time) {
    const c = world.player.onFoot ? null : world.player.car;
    if (c && Math.abs(c.speed) > 140) {
      const drift = Math.abs(Math.sin(c.angle) * c.vx - Math.cos(c.angle) * c.vy);
      if (drift > 60 && Math.random() < 0.5) {
        world.particles.push({
          x: c.x - Math.cos(c.angle) * 20, y: c.y - Math.sin(c.angle) * 20,
          vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30 - 10,
          life: 0.7, color: 'rgba(210,210,215,0.55)', size: 7 + Math.random() * 6,
        });
      }
    }
    void time;
  }

  // --- fog of war: coarse grid over the minimap, chunk marked explored when the player passes ---
  function updateFog(world) {
    const W = 27;
    if (state.fogW !== W) {
      state.fogW = W;
      state.fog = new Uint8Array(W * W);
    }
    const p = world.player;
    const cx = Math.floor((p.x / WORLD_W) * W);
    const cy = Math.floor((p.y / WORLD_H) * W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const fx = cx + dx;
        const fy = cy + dy;
        if (fx >= 0 && fy >= 0 && fx < W && fy < W) state.fog[fy * W + fx] = 1;
      }
    }
  }

  function drawLightCone(world, cam, night) {
    // headlight cones at night for the player + moving traffic + cop cars
    if (!night) return;
    const cones = [];
    for (const c of world.cars) {
      if (c.burn || c.role === 'wreck') continue;
      if (c.role !== 'player' && c.role !== 'cop' && Math.abs(c.speed) < 8) continue;
      cones.push(c);
    }
    for (const c of cones) {
      const x = c.x - cam.x;
      const y = c.y - cam.y;
      if (x < -160 || y < -160 || x > VIEW_W + 160 || y > VIEW_H + 160) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(c.angle);
      const len = 150;
      const hw = 44;
      const grad = ctx.createRadialGradient(20, 0, 6, 20 + len / 2, 0, len);
      grad.addColorStop(0, 'rgba(255, 240, 190, 0.28)');
      grad.addColorStop(1, 'rgba(255, 240, 190, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(20, -6);
      ctx.lineTo(20 + len, -hw);
      ctx.lineTo(20 + len, hw);
      ctx.lineTo(20, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawLampGlow(world, cam, dayT) {
    // soft radial pool of light under each lit street lamp after dusk
    const hour = ((dayT + 0.5) % 1) * 24;
    if (hour < 19 && hour > 6.5) return;
    const lit = [];
    for (let ty = Math.max(0, Math.floor(cam.y / TILE) - 2); ty <= Math.min(world.mh - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1); ty++) {
      for (let tx = Math.max(0, Math.floor(cam.x / TILE) - 2); tx <= Math.min(world.mw - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1); tx++) {
        if (world.tiles[ty * world.mw + tx] !== T_ROAD) continue;
        const gx = tx % 6;
        const gy = ty % 6;
        const edge = (gy === 0 && tx % 18 === 0) || (gx === 0 && ty % 18 === 0);
        if (!edge) continue;
        const x = tx * TILE - cam.x + 4;
        const y = ty * TILE - cam.y + 6;
        const flick = 0.75 + 0.25 * Math.sin(world.time * 9 + tx * 3.7 + ty * 1.3);
        const g = ctx.createRadialGradient(x, y, 2, x, y, 70);
        g.addColorStop(0, `rgba(255, 226, 150, ${0.20 * flick})`);
        g.addColorStop(1, 'rgba(255, 226, 150, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 70, y - 70, 140, 140);
        lit.push([x, y]);
      }
    }
    state.glowLights = lit;
  }

  function drawWater(world, cam, time, dayT, night) {
    // shimmer at the coast: animated wave stripes inside ocean tiles
    const base = night ? '#16233c' : '#2c6d9e';
    const tx0 = Math.max(0, Math.floor(cam.x / TILE));
    const ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(world.mw - 1, Math.ceil((cam.x + VIEW_W) / TILE));
    const ty1 = Math.min(world.mh - 1, Math.ceil((cam.y + VIEW_H) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (world.tiles[ty * world.mw + tx] !== 5) continue;
        const x = tx * TILE - cam.x;
        const y = ty * TILE - cam.y;
        ctx.fillStyle = base;
        ctx.fillRect(x, y, TILE, TILE);
        // a few moving highlight arcs per tile
        for (let i = 0; i < 2; i++) {
          const ph = world.time * 1.6 + tx * 0.7 + ty * 0.53 + i * 2.2;
          const wy = y + ((ph % 1) * TILE);
          const wx = x + ((Math.sin(ph * 2.7) * 0.5 + 0.5) * (TILE - 34));
          ctx.strokeStyle = `rgba(210, 235, 250, ${0.14 + 0.08 * Math.sin(ph * 3) + (dayT > 0.4 && dayT < 0.6 ? 0.05 : 0)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + 17, wy - 4, wx + 34, wy);
          ctx.stroke();
        }
      }
    }
  }

  function circle(x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }

  function drawWorldLayer(world, cam, dayT) {
    // tiles
    const tx0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const ty0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const tx1 = Math.min(world.mw - 1, Math.ceil((cam.x + VIEW_W) / TILE));
    const ty1 = Math.min(world.mh - 1, Math.ceil((cam.y + VIEW_H) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = world.tiles[ty * world.mw + tx];
        const x = tx * TILE - cam.x;
        const y = ty * TILE - cam.y;
        let base;
        if (t === T_ROAD) base = COLORS.road;
        else if (t === T_SIDEWALK) base = COLORS.sidewalk;
        else if (t === T_PARK) base = (tx + ty) % 2 === 0 ? COLORS.grass : COLORS.grassDark;
        else if (t === T_LOT) base = COLORS.lot;
        else base = COLORS.sidewalk;
        ctx.fillStyle = base;
        ctx.fillRect(x, y, TILE + 1, TILE + 1);
        if (t === T_ROAD) {
          // dashed yellow centre line between the two lanes
          const gx = tx % 6;
          const gy = ty % 6;
          const dash = ((tx + ty) % 4) < 2;
          ctx.fillStyle = COLORS.roadLineYellow;
          if ((gy === 0 || gy === 1) && dash) ctx.fillRect(x + 4, y + TILE * 0.48, TILE - 8, 3);
          else if ((gx === 0 || gx === 1) && dash) ctx.fillRect(x + TILE * 0.48, y + 4, 3, TILE - 8);
        } else if (t === T_SIDEWALK) {
          ctx.strokeStyle = COLORS.sidewalkLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }
    }
    // street lamps: one per road-lane tile corner on a hash pattern
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (world.tiles[ty * world.mw + tx] !== T_ROAD) continue;
        const gx = tx % 6;
        const gy = ty % 6;
        const edge = (gy === 0 && tx % 18 === 0) || (gx === 0 && ty % 18 === 0);
        if (!edge) continue;
        const x = tx * TILE - cam.x;
        const y = ty * TILE - cam.y;
        circle(x + 4, y + 6, 5, COLORS.shadow);
        ctx.fillStyle = '#3c4046';
        ctx.fillRect(x + 2, y + 4, 5, 5);
        circle(x + 4, y + 4, 3, dayT > 0.75 || dayT < 0.22 ? '#ffe9a8' : '#8b8f96');
      }
    }
    // trees
    for (const tr of world.trees) {
      const x = tr.x - cam.x;
      const y = tr.y - cam.y;
      if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) continue;
      ctx.fillStyle = COLORS.shadow;
      circle(x + 4, y + 5, tr.r, COLORS.shadow);
      circle(x, y, tr.r, COLORS.tree);
      circle(x - tr.r * 0.3, y - tr.r * 0.3, tr.r * 0.5, '#4f9440');
    }
  }

  function drawBuildings(world, cam) {
    for (const b of world.buildings) {
      const x = b.x - cam.x;
      const y = b.y - cam.y;
      if (x + b.w < 0 || y + b.h < 0 || x > VIEW_W || y > VIEW_H) continue;
      const pal = BLOCK_PALETTES[b.palette];
      // drop shadow
      ctx.fillStyle = COLORS.shadow;
      ctx.fillRect(x + 7, y + 9, b.w, b.h);
      // roof (what you see from above)
      ctx.fillStyle = pal.roof;
      ctx.fillRect(x, y, b.w, b.h);
      ctx.fillStyle = pal.wall;
      ctx.fillRect(x + 5, y + 5, b.w - 10, b.h - 10);
      ctx.fillStyle = pal.roof;
      ctx.fillRect(x + 10, y + 10, b.w - 20, b.h - 20);
      // windows grid
      ctx.fillStyle = pal.trim;
      const cols = Math.floor(b.w / 22);
      const rows = Math.floor(b.h / 22);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = hash01(b.seed + r * 31 + c * 7);
          ctx.fillStyle = lit > 0.72 ? '#ffe9a8' : pal.trim;
          ctx.fillRect(x + 12 + c * 22, y + 12 + r * 22, 10, 10);
        }
      }
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, b.w - 2, b.h - 2);
    }
  }

  function hash01(n) {
    let h = Math.imul(n | 0, 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1597334677);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function drawCar(c, cam, time, isPlayer) {
    const x = c.x - cam.x;
    const y = c.y - cam.y;
    if (x < -80 || y < -80 || x > VIEW_W + 80 || y > VIEW_H + 80) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(c.angle);
    // shadow
    ctx.fillStyle = COLORS.shadow;
    roundRect(-CAR_L / 2 + 4, -CAR_W / 2 + 5, CAR_L, CAR_W, 7);
    ctx.fill();
    // body
    ctx.fillStyle = c.role === 'cop' ? '#e8e8ee' : c.color;
    roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 7);
    ctx.fill();
    if (c.role === 'cop') {
      // black-and-white livery, light bar
      ctx.fillStyle = '#20242c';
      ctx.fillRect(-CAR_L / 2 + 4, -CAR_W / 2, 10, CAR_W);
      const flash = Math.floor(time * 6) % 2 === 0;
      ctx.fillStyle = flash ? COP_LIGHTS[0] : COP_LIGHTS[1];
      ctx.fillRect(-4, -CAR_W / 2 - 2, 8, 5);
      ctx.fillStyle = flash ? COP_LIGHTS[1] : COP_LIGHTS[0];
      ctx.fillRect(-4, CAR_W / 2 - 3, 8, 5);
    }
    // windshield and roof
    ctx.fillStyle = 'rgba(20, 26, 34, 0.85)';
    ctx.fillRect(CAR_L / 2 - 14, -CAR_W / 2 + 3, 9, CAR_W - 6);
    ctx.fillRect(-CAR_L / 2 + 8, -CAR_W / 2 + 3, 6, CAR_W - 6);
    ctx.fillStyle = isPlayer ? shade(c.role === 'cop' ? '#e8e8ee' : c.color, -18) : shade(c.role === 'cop' ? '#e8e8ee' : c.color, -10);
    ctx.fillRect(-CAR_L / 2 + 14, -CAR_W / 2 + 2, 16, CAR_W - 4);
    // wheels
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(-CAR_L / 2 + 4, -CAR_W / 2 - 3, 9, 4);
    ctx.fillRect(-CAR_L / 2 + 4, CAR_W / 2 - 1, 9, 4);
    ctx.fillRect(CAR_L / 2 - 13, -CAR_W / 2 - 3, 9, 4);
    ctx.fillRect(CAR_L / 2 - 13, CAR_W / 2 - 1, 9, 4);
    // damage
    if (c.hp < CAR && c.hp !== undefined) {
      ctx.fillStyle = 'rgba(30,30,30,0.5)';
      if (c.hp < 40) ctx.fillRect(-CAR_L / 2 + 2, -CAR_W / 2 + 2, 8, CAR_W - 4);
    }
    if (c.burn && c.burn > 0 && c.burn < 900) {
      ctx.fillStyle = Math.random() < 0.5 ? '#e08a2f' : '#f5c542';
      circle((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 4 + Math.random() * 4, null);
      ctx.fill();
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPed(ped, cam, time) {
    const x = ped.x - cam.x;
    const y = ped.y - cam.y;
    if (x < -30 || y < -30 || x > VIEW_W + 30 || y > VIEW_H + 30) return;
    ctx.save();
    ctx.translate(x, y);
    if (ped.dead) {
      ctx.rotate(ped.angle);
      ctx.fillStyle = '#7a2820';
      ctx.fillRect(-9, -4, 18, 8);
      ctx.fillStyle = SKIN[0];
      circle(9, 0, 4, SKIN[0]);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.rotate(ped.angle);
    // shadow
    ctx.fillStyle = COLORS.shadow;
    circle(2, 3, 8, COLORS.shadow);
    ctx.fill();
    // feet (walk cycle)
    const sw = Math.sin(ped.phase) * 4;
    ctx.fillStyle = '#2a2c30';
    ctx.fillRect(-2, -6 + sw, 5, 4);
    ctx.fillRect(-2, 2 - sw, 5, 4);
    // body
    ctx.fillStyle = ped.shirt;
    circle(0, 0, 7, ped.shirt);
    ctx.fill();
    // head
    ctx.fillStyle = SKIN[Math.floor(hash01(ped.phase * 100) * SKIN.length)];
    circle(2, 0, 4.5, null);
    ctx.fill();
    ctx.restore();
  }

  function drawCop(cop, cam) {
    const x = cop.x - cam.x;
    const y = cop.y - cam.y;
    if (x < -30 || y < -30 || x > VIEW_W + 30 || y > VIEW_H + 30) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(cop.angle);
    ctx.fillStyle = COLORS.shadow;
    circle(2, 3, 8, COLORS.shadow);
    ctx.fill();
    ctx.fillStyle = '#2b3a5c';
    circle(0, 0, 7, '#2b3a5c');
    ctx.fill();
    ctx.fillStyle = '#f4d03f';
    ctx.fillRect(-1, -7, 3, 3);
    ctx.fillStyle = SKIN[1];
    circle(2, 0, 4.5, SKIN[1]);
    ctx.fill();
    // gun
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(5, 2, 7, 3);
    ctx.restore();
  }

  function drawPlayer(world, cam) {
    const p = world.player;
    if (!p.onFoot) return;
    const x = p.x - cam.x;
    const y = p.y - cam.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.angle);
    ctx.fillStyle = COLORS.shadow;
    circle(2, 4, 9, COLORS.shadow);
    ctx.fill();
    const sw = Math.sin(p.walkPhase) * 4;
    ctx.fillStyle = '#2a2c30';
    ctx.fillRect(-3, -7 + sw, 6, 5);
    ctx.fillRect(-3, 2 - sw, 6, 5);
    // leather jacket
    ctx.fillStyle = '#3a2f28';
    circle(0, 0, 8, '#3a2f28');
    ctx.fill();
    // head + shades
    ctx.fillStyle = '#e0a878';
    circle(2, 0, 5, '#e0a878');
    ctx.fill();
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(3, -4, 4, 3);
    ctx.fillRect(3, 1, 4, 3);
    // pistol
    if (p.fireCd > PLAYER.fireCooldown - 0.08) {
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(8, 2, 8, 3);
    }
    ctx.restore();
  }

  function drawPickups(world, cam, time) {
    for (const k of world.pickups) {
      if (k.taken) continue;
      const x = k.x - cam.x;
      const y = k.y - cam.y;
      if (x < -20 || y < -20 || x > VIEW_W + 20 || y > VIEW_H + 20) continue;
      const bob = Math.sin(time * 4 + k.x * 0.05) * 2;
      if (k.kind === 'cash') {
        ctx.fillStyle = COLORS.shadow;
        ctx.fillRect(x - 9 + 2, y - 6 + 3 + bob, 18, 12);
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(x - 9, y - 6 + bob, 18, 12);
        ctx.fillStyle = '#2c5c34';
        ctx.fillRect(x - 6, y - 2 + bob, 12, 4);
        ctx.fillStyle = '#e8f5e0';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('$', x - 2, y + 3 + bob);
      } else {
        ctx.fillStyle = COLORS.shadow;
        ctx.fillRect(x - 7 + 2, y - 7 + 3 + bob, 14, 14);
        ctx.fillStyle = COLORS.red;
        ctx.fillRect(x - 7, y - 7 + bob, 14, 14);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 5, y - 1 + bob, 10, 2);
        ctx.fillRect(x - 1, y - 5 + bob, 2, 10);
      }
    }
    // mission markers
    const m = world.mission;
    if (m) {
      for (const t of m.targets) {
        if (m.kind === 'collect' && t.got) continue;
        if (m.kind === 'wreck' && (t.burn || t.role === 'wreck')) continue;
        const x = t.x - cam.x;
        const y = t.y - cam.y;
        const pulse = 10 + Math.sin(time * 5) * 4;
        ctx.strokeStyle = m.kind === 'wreck' ? COLORS.red : COLORS.gold;
        ctx.lineWidth = 3;
        circle(x, y, pulse + 12, null, m.kind === 'wreck' ? COLORS.red : COLORS.gold, 3);
        ctx.stroke();
        ctx.fillStyle = m.kind === 'wreck' ? COLORS.red : COLORS.gold;
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(m.kind === 'wreck' ? '✕' : '◆', x, y + 4);
        ctx.textAlign = 'left';
      }
    }
  }

  function drawBullets(world, cam) {
    ctx.fillStyle = '#ffe9a8';
    for (const b of world.bullets) {
      ctx.fillRect(b.x - cam.x - 2, b.y - cam.y - 2, 5, 3);
    }
    for (const pt of world.particles) {
      ctx.globalAlpha = Math.min(1, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - cam.x - pt.size / 2, pt.y - cam.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    for (const t of world.texts) {
      ctx.globalAlpha = Math.min(1, t.life / 0.5);
      ctx.fillStyle = t.color;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.str, t.x - cam.x, t.y - cam.y - (1 - t.life / t.max) * 26);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  // --- HUD ---

  function star(x, y, r, filled) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = filled ? COLORS.gold : 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawMinimap(world) {
    const MW2 = 168;
    const x = VIEW_W - MW2 - 18;
    const y = 18;
    const scale = MW2 / (WORLD_W * 0.5);
    ctx.fillStyle = COLORS.hud;
    roundRect(x, y, MW2, MW2, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    roundRect(x, y, MW2, MW2, 8);
    ctx.clip();
    // tiles: sample every 2nd tile
    const ts = TILE * 2 * scale * 2;
    for (let ty = 0; ty < world.mh; ty += 2) {
      for (let tx = 0; tx < world.mw; tx += 2) {
        const t = world.tiles[ty * world.mw + tx];
        const px = x + (tx * TILE / 2) * scale * 2;
        const py = y + (ty * TILE / 2) * scale * 2;
        if (px > x + MW2 || py > y + MW2) continue;
        ctx.fillStyle = t === T_ROAD ? '#555b64' : t === T_PARK ? '#4c7a40' : t === T_LOT ? '#5c5f66' : t === T_BUILDING ? '#8a7a68' : '#7d786e';
        ctx.fillRect(px, py, ts + 1, ts + 1);
      }
    }
    const p = world.player;
    const mx = (v) => x + (v / WORLD_W) * MW2 * 2;
    const my = (v) => y + (v / WORLD_H) * MW2 * 2;
    // cops as red dots
    for (const c of world.cops) {
      if (c.role !== 'cop') continue;
      ctx.fillStyle = COP_LIGHTS[0];
      ctx.fillRect(mx(c.x) - 2, my(c.y) - 2, 4, 4);
    }
    // mission targets
    if (world.mission) {
      for (const t of world.mission.targets) {
        if (world.mission.kind === 'collect' && t.got) continue;
        if (world.mission.kind === 'wreck' && (t.burn || t.role === 'wreck')) continue;
        ctx.fillStyle = COLORS.gold;
        ctx.beginPath();
        ctx.arc(mx(t.x), my(t.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // player arrow
    ctx.save();
    ctx.translate(mx(p.x), my(p.y));
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawHUD(world) {
    const p = world.player;
    // day/night clock: dayT 0.28 start-of-day
    const hour = Math.floor(((world.dayT + 0.5) % 1) * 24);
    const isNight = world.dayT > 0.78 || world.dayT < 0.23;
    ctx.fillStyle = COLORS.hud;
    roundRect(VIEW_W / 2 - 300, 18, 180, 34, 8);
    ctx.fill();
    ctx.fillStyle = isNight ? COLORS.gold : COLORS.hudText;
    ctx.font = 'bold 16px monospace';
    ctx.fillText((isNight ? '☾ ' : '☀ ') + String(hour).padStart(2, '0') + ':00', VIEW_W / 2 - 282, 41);
    if (world.district) {
      ctx.fillStyle = COLORS.hud;
      roundRect(VIEW_W / 2 - 110, 18, 220, 34, 8);
      ctx.fill();
      ctx.fillStyle = COLORS.gold;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(world.district, VIEW_W / 2, 41);
      ctx.textAlign = 'left';
    }
    // top-left: cash + wanted
    ctx.fillStyle = COLORS.hud;
    roundRect(18, 18, 250, 108, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLORS.green;
    ctx.font = 'bold 26px monospace';
    ctx.fillText(`$${world.money}`, 34, 52);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = '12px monospace';
    ctx.fillText('PALM COAST — ' + (p.onFoot ? 'ON FOOT' : 'DRIVING'), 34, 72);
    for (let i = 0; i < 5; i++) star(46 + i * 30, 100, 11, i < world.wanted);
    // health bar
    const hx = 18;
    const hy = 138;
    ctx.fillStyle = COLORS.hud;
    roundRect(hx, hy, 250, 26, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(hx + 8, hy + 7, 200, 12);
    const frac = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = frac > 0.5 ? COLORS.green : frac > 0.25 ? COLORS.gold : COLORS.red;
    ctx.fillRect(hx + 8, hy + 7, 200 * frac, 12);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('HP', hx + 216, hy + 17);
    // car condition when driving
    if (!p.onFoot && p.car) {
      ctx.fillStyle = COLORS.hud;
      roundRect(hx, hy + 34, 250, 26, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(hx + 8, hy + 41, 200, 12);
      const cf = Math.max(0, p.car.hp / 60);
      ctx.fillStyle = cf > 0.5 ? COLORS.blue : cf > 0.25 ? COLORS.gold : COLORS.red;
      ctx.fillRect(hx + 8, hy + 41, 200 * cf, 12);
      ctx.fillStyle = COLORS.hudText;
      ctx.fillText('CAR', hx + 216, hy + 51);
    }
    // mission + dialogue box
    if (world.mission) {
      const m = world.mission;
      ctx.fillStyle = COLORS.hud;
      roundRect(VIEW_W / 2 - 300, VIEW_H - 92, 600, 62, 10);
      ctx.fill();
      ctx.strokeStyle = COLORS.gold;
      ctx.stroke();
      ctx.fillStyle = COLORS.gold;
      ctx.font = 'bold 14px monospace';
      ctx.fillText('MISSION ' + (world.missionsDone + 1) + '/7 — $' + m.reward, VIEW_W / 2 - 284, VIEW_H - 70);
      ctx.fillStyle = COLORS.hudText;
      ctx.font = '13px monospace';
      let progress = '';
      if (m.kind === 'collect') {
        const got = m.targets.filter((t) => t.got).length;
        progress = ` (${got}/${m.targets.length} bags)`;
      } else if (m.kind === 'wreck') {
        const left = m.targets.filter((c) => c.hp > 0 && c.role !== 'wreck').length;
        progress = ` (${m.targets.length - left}/${m.targets.length} wrecked)`;
      } else if (m.kind === 'survive') {
        progress = ` (${Math.min(40, Math.floor(world.surviveTimer))}s/40s)`;
      } else if (m.kind === 'steal') {
        progress = ' (jack any car)';
      }
      ctx.fillText(m.brief + progress, VIEW_W / 2 - 284, VIEW_H - 48);
    }
    // Manny dialogue bubble
    if (world.dialog && world.dialogT > 0) {
      ctx.globalAlpha = Math.min(1, world.dialogT / 0.6);
      ctx.fillStyle = 'rgba(20, 16, 10, 0.82)';
      roundRect(VIEW_W / 2 - 320, VIEW_H - 158, 640, 50, 10);
      ctx.fill();
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'italic 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(world.dialog, VIEW_W / 2, VIEW_H - 128);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    drawMinimap(world);
  }

  function centreText(lines, y0, lh) {
    ctx.textAlign = 'center';
    let y = y0;
    for (const [str, font, color] of lines) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(str, VIEW_W / 2, y);
      y += lh;
    }
    ctx.textAlign = 'left';
  }

  return {
    draw(world, screen, best) {
      const p = world.player;
      // camera follows the player, clamped to the world
      const cam = {
        x: Math.max(0, Math.min(WORLD_W - VIEW_W, p.x - VIEW_W / 2)),
        y: Math.max(0, Math.min(WORLD_H - VIEW_H, p.y - VIEW_H / 2)),
      };
      // daylight tint
      const dayT = world.dayT ?? 0.5;
      const night = dayT > 0.78 || dayT < 0.23;
      const dusk = !night && (dayT > 0.68 || dayT < 0.3);
      updateBooms(world, cam, world.time);
      updateFog(world);
      // screenshake
      ctx.save();
      if (state.shake > 0.2) {
        ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
        state.shake *= 0.88;
      } else state.shake = 0;
      ctx.fillStyle = night ? '#1c2438' : dusk ? '#c98f6f' : '#8fb8c9';
      ctx.fillRect(-40, -40, VIEW_W + 80, VIEW_H + 80);
      drawWorldLayer(world, cam, dayT);
      drawLampGlow(world, cam, dayT);
      drawBuildings(world, cam);
      drawPickups(world, cam, world.time);
      for (const c of world.cars) drawCar(c, cam, world.time, c.role === 'player');
      for (const ped of world.peds) drawPed(ped, cam, world.time);
      for (const cop of world.cops) if (cop.role === 'cop') drawCop(cop, cam);
      drawPlayer(world, cam);
      drawLightCone(world, cam, world.dayT);
      drawSmoke(world, cam, world.time);
      drawBooms(world, cam);
      ctx.restore(); // end screenshake
      // night/dusk overlay above the world, below the HUD
      if (night) {
        ctx.fillStyle = 'rgba(10, 14, 34, 0.45)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      } else if (dusk) {
        ctx.fillStyle = 'rgba(120, 60, 40, 0.18)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (world.cityTaken) {
        ctx.fillStyle = 'rgba(12, 14, 20, 0.55)';
        roundRect(VIEW_W / 2 - 260, VIEW_H / 2 - 44, 520, 88, 12);
        ctx.fill();
        ctx.strokeStyle = COLORS.gold;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.gold;
        ctx.font = 'bold 44px monospace';
        ctx.fillText('CITY TAKEN', VIEW_W / 2, VIEW_H / 2 + 2);
        ctx.fillStyle = COLORS.hudText;
        ctx.font = '15px monospace';
        ctx.fillText('Manny\'s empire is complete — the Coast is yours.', VIEW_W / 2, VIEW_H / 2 + 30);
        ctx.textAlign = 'left';
      }
      if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) {
        drawHUD(world);
        if (screen === SCREEN_PAUSED) {
          ctx.fillStyle = 'rgba(8, 10, 16, 0.6)';
          ctx.fillRect(0, 0, VIEW_W, VIEW_H);
          centreText([
            ['PAUSED', 'bold 54px monospace', COLORS.hudText],
            ['P or ESC to resume', '16px monospace', 'rgba(242,237,226,0.7)'],
          ], VIEW_H / 2 - 20, 44);
        }
      } else if (screen === SCREEN_TITLE) {
        ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        centreText([
          ['PALM COAST', 'bold 84px monospace', COLORS.gold],
          ['CRIME DOES PAY — IF YOU OUTDRIVE THE HEAT', 'bold 20px monospace', COLORS.hudText],
          ['', '12px monospace', ''],
          ['Steal cars. Run jobs for Manny. Wreck gang rides. Lose the stars.', '16px monospace', 'rgba(242,237,226,0.85)'],
          ['', '12px monospace', ''],
          ['WASD / ARROWS  move & drive      E  enter / exit car', '15px monospace', COLORS.hudText],
          ['F or SPACE  shoot      P / ESC  pause      M  mute      N  new game', '15px monospace', COLORS.hudText],
          ['', '12px monospace', ''],
          ['PRESS ENTER TO HIT THE COAST', 'bold 24px monospace', Math.sin(world.time * 4) > -0.2 ? '#ffffff' : 'rgba(255,255,255,0.25)'],
        ], VIEW_H / 2 - 170, 44);
      } else if (screen === SCREEN_OVER) {
        ctx.fillStyle = world.busted ? 'rgba(24, 32, 64, 0.82)' : 'rgba(64, 16, 16, 0.82)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        centreText([
          [world.busted ? 'BUSTED' : 'WASTED', 'bold 88px monospace', world.busted ? '#7fa8e8' : COLORS.red],
          ['', '12px monospace', ''],
          [`CASH EARNED   $${world.money}`, 'bold 22px monospace', COLORS.hudText],
          [`MISSIONS DONE   ${world.missionsDone}`, '18px monospace', COLORS.hudText],
          [`TAKEDOWNS   ${world.stats.kills}      CARS STOLEN   ${world.stats.steals}`, '18px monospace', COLORS.hudText],
          ['', '12px monospace', ''],
          [`BEST HAUL   $${best}`, '18px monospace', COLORS.gold],
          ['', '12px monospace', ''],
          ['ENTER — back to the coast      N — fresh start', '16px monospace', 'rgba(242,237,226,0.8)'],
        ], VIEW_H / 2 - 200, 46);
      }
      // mute hint
      ctx.fillStyle = 'rgba(242,237,226,0.45)';
      ctx.font = '11px monospace';
      ctx.fillText('M — sound ' + (world.audioMuted ? 'OFF' : 'ON'), 18, VIEW_H - 14);
    },
  };
}
