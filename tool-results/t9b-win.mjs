/**
 * T9-b E2E helper — build a valid winning move history for a CUSTOM board
 * layout (bottom-first, 0 = blank) using the real engine (copied verbatim to
 * t9b-engine.ts). Random cooperative rollouts: P1 grabs landing cells whose
 * number belongs to a 4-window; P2 avoids them (exposing deeper cells).
 * Prints JSON: { layout, history, type, numbers }
 * Usage: bun tool-results/t9b-win.mjs
 */
import { createGame, applyMove, COLS, ROWS } from './t9b-engine.ts';

/* classic board (bottom-first) with 2 cell tweaks: idx1 7→5, idx5 3→7 */
const LAYOUT = [
  6, 5, null, 4, 3, 7, 9, 7, null,
  5, null, 2, 8, 5, 5, 8, null, null,
  null, null, 4, 4, 1, 6, 9, 6, null,
  3, 6, 8, 5, 4, 2, null, 7, 1,
  2, 8, 1, 9, 7, 9, 2, 8, 1,
  7, 5, null, 6, 9, 1, null, 7, 3,
  1, 9, 3, 2, 5, 8, 1, 3, 2,
];

const landingSet = (st, want) => {
  const cols = [];
  for (let col = 0; col < COLS; col++) {
    const row = st.heights[col];
    if (row < ROWS && want.has(st.cells[row * COLS + col].n)) cols.push(col);
  }
  return cols;
};
const landingNot = (st, want) => {
  const cols = [];
  for (let col = 0; col < COLS; col++) {
    const row = st.heights[col];
    if (row < ROWS && !want.has(st.cells[row * COLS + col].n)) cols.push(col);
  }
  return cols;
};
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rollout(window) {
  const st = createGame(LAYOUT.map((v) => (v === 0 ? null : v)), 'ct9b-test-strait');
  for (let ply = 0; ply < 63; ply++) {
    let col;
    if (st.turn === 1) {
      const hit = landingSet(st, window);
      if (hit.length) col = rnd(hit);
      else { const safe = landingNot(st, window); col = safe.length ? rnd(safe) : rnd(st.heights.map((h, c) => (h < ROWS ? c : -1)).filter((c) => c >= 0)); }
    } else {
      const safe = landingNot(st, window);
      col = safe.length ? rnd(safe) : -1;
      if (col < 0) return null;
    }
    if (applyMove(st, col) < 0) return null;
    if (st.result) {
      if (st.result.winner === 1 && (st.result.type === 'KIND' || st.result.type === 'RUN')) {
        return { history: st.history.slice(), type: st.result.type, numbers: st.result.numbers };
      }
      return null;
    }
  }
  return null;
}

let out = null;
outer:
for (let k = 1; k <= 6 && !out; k++) {
  const win = new Set([k, k + 1, k + 2, k + 3]);
  for (let attempt = 0; attempt < 30000; attempt++) {
    out = rollout(win);
    if (out) { console.error(`window ${k}..${k + 3} won after ${attempt + 1} rollouts`); break outer; }
  }
}
if (!out) { console.error('no winning line found'); process.exit(1); }
console.log(JSON.stringify({ layout: LAYOUT.map((v) => (v === null ? 0 : v)), ...out }));
