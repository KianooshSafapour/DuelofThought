/**
 * Minimal board generation for the online service — replicates
 * `generateBoard` / `mulberry32` from src/lib/game/boards.ts so that a
 * board id like "s123456" resolves to the exact same 63 cells the client
 * computes with its own copy of the code.
 */
import { TOTAL } from './engine';

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
 * Generate a balanced random board (same algorithm as the main app):
 *  - every number 1..9 appears at least 5 times (4-of-a-kind reachable)
 *  - exactly `blanks` blank cells (never dropping a number below the minimum)
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

/** Parse a "s<seed>" board id into its 63 numbers; null for unknown ids. */
export function boardNumbersForId(id: string): (number | null)[] | null {
  const m = /^s(\d+)$/.exec(id);
  if (!m) return null;
  return generateBoard(parseInt(m[1], 10) >>> 0, 14);
}
