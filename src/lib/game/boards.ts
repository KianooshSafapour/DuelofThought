/**
 * Board catalog: the classic physical board (transcribed from the original
 * paper board designed by the 6 mathematicians) + seeded procedural boards.
 * Layout: row 0 = BOTTOM row. Each entry: number 1..9 or null (blank cell).
 * Transcription of the classic board, top row first as printed on paper,
 * then flipped so index 0 is the bottom row.
 */
import { COLS, ROWS, TOTAL } from './engine';

const CLASSIC_BOTTOM_FIRST: (number | null)[] = [
  // printed bottom row — NOTE: four blank cells (idx 0,3,21,25) were given numbers
  // (6,4,4,6) in the digital edition so every number 1..9 can reach a 4-of-a-kind.
  6, 7, null, 4, 3, 3, 9, 7, null,
  // row 5 (printed 2nd from bottom)
  5, null, 2, 8, 5, 5, 8, null, null,
  // row 4 (printed middle)
  null, null, 4, 4, 1, 6, 9, 6, null,
  // row 3
  3, 6, 8, 5, 4, 2, null, 7, 1,
  // row 2
  2, 8, 1, 9, 7, 9, 2, 8, 1,
  // row 1
  7, 5, null, 6, 9, 1, null, 7, 3,
  // printed top row
  1, 9, 3, 2, 5, 8, 1, 3, 2,
];

export const CLASSIC_BOARD: (number | null)[] = CLASSIC_BOTTOM_FIRST;

export interface BoardDef {
  id: string;
  numbers: (number | null)[];
  daily?: boolean;
}

/* ---------- deterministic PRNG (mulberry32) ---------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a balanced random board. Guarantees:
 *  - every number 1..9 appears at least `minPerNumber` times (so 4-of-a-kind is always reachable)
 *  - a configurable amount of blank cells (strategic blockers)
 *  - at least one full consecutive window has all its numbers present at least 3 times
 */
export function generateBoard(seed: number, blanks = 14): (number | null)[] {
  const rnd = mulberry32(seed);
  const board: number[] = new Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) board[i] = 1 + Math.floor(rnd() * 9);

  // enforce minimum presence of each number
  const minPerNumber = 5;
  for (let n = 1; n <= 9; n++) {
    let c = board.filter((x) => x === n).length;
    let guard = 0;
    while (c < minPerNumber && guard++ < 200) {
      const i = Math.floor(rnd() * TOTAL);
      if (board[i] !== n) { board[i] = n; c++; }
    }
  }

  // carve blanks, but never leave any number below the minimum
  const count: number[] = new Array(10).fill(0);
  for (const x of board) count[x]++;
  const idx = [...Array(TOTAL).keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let made = 0;
  for (const i of idx) {
    if (made >= blanks) break;
    if (count[board[i]] > minPerNumber) {
      count[board[i]]--;
      board[i] = 0; // 0 => blank
      made++;
    }
  }
  return board.map((x) => (x === 0 ? null : x));
}

/** Deterministic daily challenge board (rotates at midnight Tehran time, UTC+3:30). */
export function dailySeed(now = new Date()): number {
  const tehran = new Date(now.getTime() + 3.5 * 3600 * 1000);
  const y = tehran.getUTCFullYear();
  const m = tehran.getUTCMonth() + 1;
  const d = tehran.getUTCDate();
  return y * 10000 + m * 100 + d;
}

/* ---------- admin-designed (custom) boards ---------- */

/**
 * Wire-format layout → engine numbers: 0 means "blank cell".
 * Layout arrays are BOTTOM-FIRST (index 0 = bottom row), values 0..9.
 */
export function layoutFromCustom(arr: number[]): (number | null)[] {
  return arr.map((v) => (v === 0 ? null : v));
}

/** Module-level cache of admin-designed boards, keyed by code (without the "c" prefix). */
const customBoards = new Map<string, (number | null)[]>();

/**
 * Register admin-designed boards for SYNCHRONOUS lookup by getBoard.
 * Called by the client after fetching GET /api/boards (play lobby / designer)
 * and by /api/game/submit before replaying a match on a custom board —
 * getBoard must stay synchronous, so lookups go through this cache.
 */
export function setCustomBoards(list: { code: string; layout: number[] }[]) {
  for (const b of list) customBoards.set(b.code, layoutFromCustom(b.layout));
}

export function getBoard(id: string): BoardDef {
  switch (id) {
    case 'classic': return { id, numbers: CLASSIC_BOARD };
    case 'daily': return { id, numbers: generateBoard(dailySeed(), 16), daily: true };
    case 'symmetry': return { id, numbers: generateBoard(20240 + dailySeed() % 7, 12) };
    case 'storm': return { id, numbers: generateBoard(90210 + (dailySeed() % 13), 20) };
    default: {
      // admin-designed custom board (e.g. "cfork-bomb") — resolved from the
      // setCustomBoards cache; falls back to the classic board if unknown
      const c = /^c([a-z0-9-]+)$/.exec(id);
      if (c) {
        const numbers = customBoards.get(c[1]);
        return numbers ? { id, numbers } : { id: 'classic', numbers: CLASSIC_BOARD };
      }
      // seeded custom board (e.g. "s12345")
      const m = /^s(\d+)$/.exec(id);
      if (m) return { id, numbers: generateBoard(parseInt(m[1], 10) >>> 0, 14) };
      return { id: 'classic', numbers: CLASSIC_BOARD };
    }
  }
}

export const BOARD_CATALOG = [
  { id: 'classic', rarity: 'COMMON' },
  { id: 'daily', rarity: 'RARE' },
  { id: 'symmetry', rarity: 'RARE' },
  { id: 'storm', rarity: 'EPIC' },
];

/* ---------- integrity self-check ---------- */
export function boardIsSound(numbers: (number | null)[]): boolean {
  if (numbers.length !== TOTAL) return false;
  const count: number[] = new Array(10).fill(0);
  let blanks = 0;
  for (const x of numbers) {
    if (x === null) blanks++;
    else if (x >= 1 && x <= 9) count[x]++;
    else return false;
  }
  if (blanks >= TOTAL - 9) return false;
  for (let n = 1; n <= 9; n++) if (count[n] < 4) return false; // every kind must be reachable
  return true;
}

/** column of a cell index / row helpers */
export function colOf(idx: number): number { return idx % COLS; }
export function rowOf(idx: number): number { return Math.floor(idx / COLS); }
export const rowsTotal = ROWS;
