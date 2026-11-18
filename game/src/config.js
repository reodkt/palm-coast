// PALM COAST build v2 by recorded agent
// PALM COAST — committed in this session.
// World and tuning constants for PALM COAST: a 2D top-down open-world crime game.
// The city is a grid: 2-tile-wide roads every 6 tiles, the 4x4 blocks between them hold
// buildings, parks and parking lots. Everything is measured in world pixels.

export const TILE = 64;
export const MW = 54;
export const MH = 54;
export const WORLD_W = MW * TILE;
export const WORLD_H = MH * TILE;

/** Tile types. */
export const T_BUILDING = 0;
export const T_ROAD = 1;
export const T_SIDEWALK = 2;
export const T_PARK = 3;
export const T_LOT = 4;

/** Fixed simulation step (seconds). */
export const STEP = 1 / 60;

export const SAVE_KEY = 'palmcoast.save.v1';

/** Player tuning. */
export const PLAYER = {
  walk: 165,
  radius: 11,
  maxHp: 100,
  fireCooldown: 0.22,
  bulletSpeed: 720,
  punchRange: 34,
};

/** Car tuning (player-driven). Smooth analog-style accel/brake with light drift. */
export const CAR = {
  maxSpeed: 330,
  reverse: -120,
  accel: 300,
  brake: 520,
  drag: 0.9,
  turn: 2.7,
  width: 26,
  length: 46,
  // driving-feel extras
  coastDrag: 0.9,      // per-second retention factor when coasting off throttle
  driftSlip: 0.82,     // lateral velocity retention while drifting (lower = grippier)
  skidSpeed: 190,      // min speed for skid marks when braking hard
};

export const TRAFFIC_SPEED = 130;
export const COP_BASE_SPEED = 250;

/** How many of each the city holds at spawn. */
export const COUNTS = { traffic: 34, parked: 22, peds: 64 };

/** District building palettes: warm art-deco pastels, sun-bleached. */
export const BLOCK_PALETTES = [
  { wall: '#8a6f5c', roof: '#c9b29a', trim: '#e8dcc8' },
  { wall: '#7d7a72', roof: '#b9b6ac', trim: '#dedbd2' },
  { wall: '#9c8570', roof: '#d6c3a5', trim: '#f0e6d4' },
  { wall: '#6f7d84', roof: '#a9bcc4', trim: '#d7e2e6' },
  { wall: '#8f7f86', roof: '#c8b6c0', trim: '#e9dfe4' },
  { wall: '#7a6a5e', roof: '#bfae9a', trim: '#e5dac7' },
  { wall: '#6d7f6a', roof: '#a8bfa2', trim: '#dbe8d6' },
  { wall: '#84766a', roof: '#c4b4a2', trim: '#ece2d4' },
  { wall: '#5f6d80', roof: '#9fb2c6', trim: '#d3dfeb' },
  { wall: '#92705e', roof: '#d0a98f', trim: '#f2ddc9' },
];

/** Named districts: 3x3 regions of the 9x9 block grid. Row-major from the north-west. */
export const DISTRICTS = [
  'NORTH SHORE', 'PALM HEIGHTS', 'EASTON DOCKS',
  'MIRAGE STRIP', 'DOWNTOWN', 'SUNSET MARKET',
  'WEST GROVE', 'LITTLE HAVANA', 'MARINA SOUTH',
];

/** Day/night: dayT in [0,1) — 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. */

export const COLORS = {
  road: '#3d4148',
  roadLine: '#c9c39a',
  roadLineYellow: '#d8b93a',
  sidewalk: '#9a958c',
  sidewalkLine: '#b3aea4',
  grass: '#6fae5c',
  grassDark: '#5d9c4c',
  tree: '#3f7d34',
  lot: '#6b6e73',
  water: '#3a7ca5',
  shadow: 'rgba(10, 12, 16, 0.28)',
  hud: 'rgba(12, 14, 20, 0.72)',
  hudText: '#f2ede2',
  gold: '#f5c542',
  red: '#e04f3f',
  green: '#5cc46a',
  blue: '#4f9de0',
};

/** Cop car light colors. */
export const COP_LIGHTS = ['#ff3b30', '#2f7bff'];
