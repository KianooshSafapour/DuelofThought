/**
 * mazemind-arenas — pure read-only arena layouts for "Mind Tank" (تانک اندیشه).
 *
 * Logical arena is 880×620 units; the canvas scales this to the container.
 * Four hand-laid neon obstacle layouts rotate per wave (wave N uses index
 * (N-1) % 4). All coordinates are top-left based wall rectangles; spawns are
 * verified free of wall overlap (see tool-results/t9d-arena-check.mjs).
 */
export interface MMWall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MMSpot {
  x: number;
  y: number;
}

export interface MMArena {
  id: string;
  walls: MMWall[];
  playerSpawn: MMSpot;
  droneSpawns: MMSpot[];
}

export const MM_ARENA_W = 880;
export const MM_ARENA_H = 620;

/* 1 · "Mirror Hall" — split centre columns reward banked shots down the gap */
const MIRROR: MMArena = {
  id: 'mirror',
  walls: [
    { x: 426, y: 56, w: 28, h: 180 },
    { x: 426, y: 384, w: 28, h: 180 },
    { x: 140, y: 246, w: 160, h: 28 },
    { x: 580, y: 346, w: 160, h: 28 },
    { x: 232, y: 104, w: 36, h: 36 },
    { x: 612, y: 480, w: 36, h: 36 },
  ],
  playerSpawn: { x: 110, y: 530 },
  droneSpawns: [
    { x: 762, y: 120 },
    { x: 762, y: 512 },
    { x: 520, y: 96 },
    { x: 350, y: 540 },
    { x: 140, y: 100 },
    { x: 760, y: 316 },
  ],
};

/* 2 · "Bastions" — four corner L-forts around a central vault */
const BASTIONS: MMArena = {
  id: 'bastions',
  walls: [
    { x: 84, y: 84, w: 150, h: 34 },
    { x: 84, y: 84, w: 34, h: 150 },
    { x: 646, y: 84, w: 150, h: 34 },
    { x: 762, y: 84, w: 34, h: 150 },
    { x: 84, y: 502, w: 150, h: 34 },
    { x: 84, y: 386, w: 34, h: 150 },
    { x: 646, y: 502, w: 150, h: 34 },
    { x: 762, y: 386, w: 34, h: 150 },
    { x: 404, y: 274, w: 72, h: 72 },
    { x: 423, y: 96, w: 34, h: 84 },
    { x: 423, y: 440, w: 34, h: 84 },
  ],
  playerSpawn: { x: 110, y: 310 },
  droneSpawns: [
    { x: 440, y: 240 },
    { x: 440, y: 400 },
    { x: 760, y: 310 },
    { x: 110, y: 560 },
    { x: 170, y: 160 },
    { x: 770, y: 560 },
  ],
};

/* 3 · "Crossfield" — open cross with four pillars, the most exposed layout */
const CROSSFIELD: MMArena = {
  id: 'crossfield',
  walls: [
    { x: 262, y: 296, w: 356, h: 28 },
    { x: 426, y: 128, w: 28, h: 364 },
    { x: 150, y: 110, w: 40, h: 40 },
    { x: 690, y: 110, w: 40, h: 40 },
    { x: 150, y: 470, w: 40, h: 40 },
    { x: 690, y: 470, w: 40, h: 40 },
  ],
  playerSpawn: { x: 110, y: 315 },
  droneSpawns: [
    { x: 110, y: 105 },
    { x: 770, y: 105 },
    { x: 110, y: 515 },
    { x: 770, y: 515 },
    { x: 440, y: 84 },
    { x: 440, y: 536 },
  ],
};

/* 4 · "Twin Forts" — staggered long walls with ledges for flanking fire */
const TWINFORTS: MMArena = {
  id: 'twinforts',
  walls: [
    { x: 150, y: 196, w: 250, h: 30 },
    { x: 480, y: 394, w: 250, h: 30 },
    { x: 400, y: 262, w: 80, h: 80 },
    { x: 86, y: 430, w: 36, h: 36 },
    { x: 758, y: 154, w: 36, h: 36 },
    { x: 250, y: 486, w: 130, h: 30 },
    { x: 540, y: 104, w: 130, h: 30 },
  ],
  playerSpawn: { x: 110, y: 120 },
  droneSpawns: [
    { x: 770, y: 520 },
    { x: 110, y: 520 },
    { x: 620, y: 250 },
    { x: 440, y: 540 },
    { x: 300, y: 140 },
    { x: 770, y: 110 },
  ],
};

/** Rotation order across the four waves. */
export const MM_ARENAS: MMArena[] = [MIRROR, BASTIONS, CROSSFIELD, TWINFORTS];

/** Wave N plays on this layout (N is 1-based). */
export function mmArenaForWave(wave: number): MMArena {
  return MM_ARENAS[(Math.max(1, wave) - 1) % MM_ARENAS.length];
}
