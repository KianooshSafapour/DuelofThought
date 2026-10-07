/**
 * AI opponent — heuristic alpha-beta minimax.
 * Eval model (from p's perspective):
 *  - KIND progress: for each number, count^2 weight; dies if no free cells with that number remain.
 *  - RUN progress: for each window of 4 consecutive numbers, weight by distinct owned count,
 *    scaled by availability (all four numbers still having free cells).
 *  - Tempo multiplier for the opponent to account for alternating turns.
 *  - Slight center-column preference (more future options).
 */
import {
  GameState, PlayerId, COLS, ROWS, cloneState, applyMove, legalMoves, detectWin,
} from './engine';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

const KIND_W = [0, 1, 3, 9];       // count 1..3
const RUN_W = [0, 0, 2, 7];        // distinct 1..3 (4 = terminal)
const OPP_TEMPO = 1.08;

function freeWithNumber(s: GameState, n: number): number {
  let c = 0;
  for (let col = 0; col < COLS; col++) {
    for (let row = s.heights[col]; row < ROWS; row++) {
      if (s.cells[row * COLS + col].n === n) c++;
    }
  }
  return c;
}

function sideScore(s: GameState, p: PlayerId, freeCache: Map<number, number>): number {
  const counts = s.counts[p - 1];
  let score = 0;
  for (let n = 1; n <= 9; n++) {
    const c = counts[n];
    if (c === 0 || c >= 4) continue;
    let free = freeCache.get(n);
    if (free === undefined) { free = freeWithNumber(s, n); freeCache.set(n, free); }
    const w = KIND_W[Math.min(c, 3)];
    score += free > 0 ? w : w * 0.2;
  }
  for (let k = 1; k <= 6; k++) {
    let d = 0;
    let avail = true;
    for (let n = k; n <= k + 3; n++) {
      if (counts[n] > 0) d++;
      let free = freeCache.get(n);
      if (free === undefined) { free = freeWithNumber(s, n); freeCache.set(n, free); }
      if (free === 0) avail = false;
    }
    if (d >= 4) return 10000; // should have been terminal
    if (d > 0) score += avail ? RUN_W[d] : RUN_W[d] * 0.35;
  }
  return score;
}

function evaluate(s: GameState, me: PlayerId): number {
  const foe: PlayerId = me === 1 ? 2 : 1;
  const cache = new Map<number, number>();
  let v = sideScore(s, me, cache) - OPP_TEMPO * sideScore(s, foe, cache);
  // tiny positional bonus: center columns keep options open
  for (let col = 0; col < COLS; col++) {
    const row = s.heights[col] - 1;
    if (row >= 0 && s.cells[row * COLS + col].o === me) {
      v += 0.06 * (4 - Math.abs(col - 4));
    }
  }
  return v;
}

function orderedMoves(s: GameState): number[] {
  const ms = legalMoves(s);
  ms.sort((a, b) => Math.abs(a - 4) - Math.abs(b - 4));
  return ms;
}

function alphabeta(
  s: GameState, depth: number, alpha: number, beta: number, me: PlayerId, deadline: number,
): number {
  if (s.result) {
    if (s.result.winner === 0) return 0;
    return s.result.winner === me ? 100000 + depth * 100 : -100000 - depth * 100;
  }
  if (depth === 0 || Date.now() > deadline) return evaluate(s, me);

  const maximizing = s.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const col of orderedMoves(s)) {
    const child = cloneState(s);
    applyMove(child, col);
    const v = alphabeta(child, depth - 1, alpha, beta, me, deadline);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function immediateWin(s: GameState, p: PlayerId): number | null {
  for (const col of legalMoves(s)) {
    const child = cloneState(s);
    if (s.turn !== p) child.turn = p; // inspect as p
    if (child.turn === p && applyMove(child, col) >= 0 && child.result && child.result.winner === p) {
      return col;
    }
  }
  return null;
}

/** Choose a column for the AI. Never throws; always returns a legal column when one exists. */
export function chooseMove(state: GameState, difficulty: Difficulty, rng: () => number = Math.random): number {
  const moves = legalMoves(state);
  if (moves.length === 0) return -1;
  const me = state.turn;

  // tactical shortcut for all levels: take an immediate win
  const winCol = immediateWin(state, me);
  if (winCol !== null) return winCol;

  if (difficulty === 'EASY') {
    // 55% heuristic-ish random (center weighted), else block if opponent threatens
    if (rng() < 0.55) {
      const weights = moves.map((c) => 5 - Math.abs(c - 4));
      let total = weights.reduce((a, b) => a + b, 0);
      let r = rng() * total;
      for (let i = 0; i < moves.length; i++) { r -= weights[i]; if (r <= 0) return moves[i]; }
    }
    const foe: PlayerId = me === 1 ? 2 : 1;
    const saved = state.turn;
    state.turn = foe;
    const block = immediateWin(state, foe);
    state.turn = saved as PlayerId;
    if (block !== null && rng() < 0.8) return block;
    const weights = moves.map((c) => 5 - Math.abs(c - 4));
    let total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < moves.length; i++) { r -= weights[i]; if (r <= 0) return moves[i]; }
    return moves[moves.length - 1];
  }

  if (difficulty === 'MEDIUM') {
    // block obvious threat, then depth-2 search with softmax-ish pick
    const foe: PlayerId = me === 1 ? 2 : 1;
    const saved = state.turn;
    state.turn = foe;
    const block = immediateWin(state, foe);
    state.turn = saved as PlayerId;
    if (block !== null && rng() < 0.85) return block;

    const deadline = Date.now() + 350;
    const scored = moves.map((col) => {
      const child = cloneState(state);
      applyMove(child, col);
      return { col, v: alphabeta(child, 1, -Infinity, Infinity, me, deadline) + rng() * 2 };
    });
    scored.sort((a, b) => b.v - a.v);
    return scored[0].col;
  }

  // HARD: block, then depth-4 alpha-beta with ordering (5-ply total lookahead)
  const foe: PlayerId = me === 1 ? 2 : 1;
  const saved2 = state.turn;
  state.turn = foe;
  const block2 = immediateWin(state, foe);
  state.turn = saved2 as PlayerId;
  if (block2 !== null) return block2;

  const deadline = Date.now() + 1500;
  const scored = moves.map((col) => {
    const child = cloneState(state);
    applyMove(child, col);
    const v = alphabeta(child, 3, -Infinity, Infinity, me, deadline);
    return { col, v };
  });
  scored.sort((a, b) => b.v - a.v);
  const top = scored.filter((x) => x.v >= scored[0].v - 0.5);
  return top[Math.floor(rng() * top.length)].col;
}
