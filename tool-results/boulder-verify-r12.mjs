#!/usr/bin/env node
/**
 * R12-b — CRITICAL solvability stress test for Boulder Yard 1+2 (one-off QA).
 *
 * Ground truth: imports the REAL engine (src/lib/game/boulder-engine.ts — bun
 * executes TS natively) and generates push successors with
 * `step(s, dir, { power: 1 })` — the EXACT action the free "Old Tractor"
 * makes in the shipped game (no dig, no grab, no chain). Any level this
 * verifier cannot solve is unbeatable for a fresh player with zero upgrades.
 *
 * Search: push-optimal BFS (walking is free; a push costs 1). Canonical state
 * = boulders ∪ pits ∪ player-reachable-set bitmasks (exact even with one-way
 * gates, because the reachable set fully determines the future under
 * push/pit/gate semantics). Budget: depth ≤ W·H·40 pushes, visited ≤ 500k.
 *
 * Also re-asserts `par` == optimum (3-star stays attainable) and checks the
 * sequential-unlock invariant data-side.
 * Output: tool-results/boulder-verify-r12-out.txt
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createGame, step, isSolved } from '../src/lib/game/boulder-engine.ts';

const OUT = fileURLToPath(new URL('./boulder-verify-r12-out.txt', import.meta.url));
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

/* ---------- level extraction from the shipped TS data files ---------- */
function extract(relFile) {
  const src = readFileSync(fileURLToPath(new URL(relFile, import.meta.url)), 'utf8');
  const blocks = [...src.matchAll(/\{ par: (\d+), ascii: \[(.*?)\]\s*\}/gs)];
  return blocks.map((m) => ({
    par: Number(m[1]),
    ascii: [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]),
  }));
}

/* ---------- engine-state helpers ---------- */
/** engine state template for a level (fidelity to shipped rules) */
function baseTemplate(def, idx) {
  const g = createGame({ par: def.par, ascii: def.ascii }, idx);
  g.history = [];
  return g;
}

/** minimal engine state clone (step() reads rows/cols/wall/gates/pits/boulders/player/solved only) */
function withPlayer(tpl, player, boulders, pits) {
  return { ...tpl, player, boulders, pits, pushes: 0, moves: 0, history: [], solved: false, lastPushed: -1, facing: 'D' };
}

/** player-reachable cell bitmask — exact engine walk rules */
function reachMask(player, boulders, pits, tpl) {
  const { rows, cols, wall, gates } = tpl;
  const n = rows * cols;
  const seen = new Uint8Array(n);
  const stack = [player];
  seen[player] = 1;
  while (stack.length) {
    const cur = stack.pop();
    for (const [dv, rowCheck] of [[-cols, 0], [cols, 0], [-1, 1], [1, 1]]) {
      const t = cur + dv;
      if (t < 0 || t >= n || seen[t]) continue;
      if (rowCheck && Math.floor(t / cols) !== Math.floor(cur / cols)) continue;
      if (wall[t] || boulders.has(t) || pits.has(t)) continue;
      const g = gates.get(t);
      if (g && ((dv === -1 && g !== 'L') || (dv === 1 && g !== 'R') || (dv === -cols && g !== 'U') || (dv === cols && g !== 'D'))) continue;
      seen[t] = 1;
      stack.push(t);
    }
  }
  return bitmask(seen, n);
}

function bitmask(seen, n) {
  let s = '';
  for (let i = 0; i < n; i += 32) {
    let word = 0;
    for (let j = 0; j < 32; j++) if (seen[i + j]) word |= 1 << j;
    s += word.toString(36) + '.';
  }
  return s;
}
const setMask = (set, n) => {
  const seen = new Uint8Array(n);
  for (const x of set) seen[x] = 1;
  return bitmask(seen, n);
};

/**
 * Push-optimal BFS with the real engine as move generator.
 * Canonical key = boulders ∪ pits ∪ player-reach bitmasks → sound & compact
 * (the reachable set fully determines the future under push/pit/gate rules).
 */
function solveLevel(tpl, depthBudget) {
  const n = tpl.rows * tpl.cols;
  const startB = new Set(tpl.boulders);
  const startP = new Set(tpl.pits);
  const startReach = reachMask(tpl.player, startB, startP, tpl);
  let layer = [{ player: tpl.player, boulders: startB, pits: startP }];
  const visited = new Set([setMask(startB, n) + setMask(startP, n) + startReach]);
  const DIRS = [['U', -tpl.cols, 0], ['D', tpl.cols, 0], ['L', -1, 1], ['R', 1, 1]];

  for (let depth = 0; depth <= depthBudget; depth++) {
    if (layer.length === 0) return { ok: false, pushes: -1, expanded: visited.size, reason: 'exhausted (no solution within budget)' };
    for (const nd of layer) {
      if (isSolved(nd.boulders, tpl.targets)) return { ok: true, pushes: depth, expanded: visited.size };
    }
    const next = [];
    for (const nd of layer) {
      const reachSet = new Uint8Array(n);
        const seen = new Uint8Array(n);
        const stack = [nd.player];
        seen[nd.player] = 1;
        while (stack.length) {
          const cur = stack.pop();
          for (const [dv, rowCheck] of [[-tpl.cols, 0], [tpl.cols, 0], [-1, 1], [1, 1]]) {
            const t = cur + dv;
            if (t < 0 || t >= n || seen[t]) continue;
            if (rowCheck && Math.floor(t / tpl.cols) !== Math.floor(cur / tpl.cols)) continue;
            if (tpl.wall[t] || nd.boulders.has(t) || nd.pits.has(t)) continue;
            const g = tpl.gates.get(t);
            if (g && ((dv === -1 && g !== 'L') || (dv === 1 && g !== 'R') || (dv === -tpl.cols && g !== 'U') || (dv === tpl.cols && g !== 'D'))) continue;
            seen[t] = 1;
            stack.push(t);
          }
        }
        for (let i = 0; i < n; i++) reachSet[i] = seen[i];
      for (const b of nd.boulders) {
        for (const [dir, dv, rowCheck] of DIRS) {
          const pusher = b - dv;
          if (pusher < 0 || pusher >= n || !reachSet[pusher]) continue;
          if (rowCheck && Math.floor(pusher / tpl.cols) !== Math.floor(b / tpl.cols)) continue;
          // engine validates the push itself (walls, gates, chain length, pits)
          const st = withPlayer(tpl, pusher, nd.boulders, nd.pits);
          const r = step(st, dir, { power: 1 });
          if (!r.moved || !r.pushed) continue;
          const nst = r.state;
          const rk = setMask(nst.boulders, n) + setMask(nst.pits, n) + reachMask(nst.player, nst.boulders, nst.pits, tpl);
          if (visited.has(rk)) continue;
          visited.add(rk);
          if (visited.size > 500_000) return { ok: false, pushes: -1, expanded: visited.size, reason: 'state budget' };
          next.push({ player: nst.player, boulders: nst.boulders, pits: nst.pits });
        }
      }
    }
    layer = next;
  }
  return { ok: false, pushes: -1, expanded: visited.size, reason: 'depth budget' };
}

/* ------------------------------ main ------------------------------ */
const campaigns = [
  { name: 'CAMPAIGN 1 — BOULDER YARD (quarry)', file: '../src/lib/game/boulder-levels.ts' },
  { name: 'CAMPAIGN 2 — BOULDER YARD II (factory)', file: '../src/lib/game/boulder2-levels.ts' },
];

say('BOULDER YARD R12-b SOLVABILITY STRESS TEST — free tractor (power=1, no abilities)');
say('Engine ground truth: src/lib/game/boulder-engine.ts step(s,dir,{power:1}) · push-optimal BFS · reach-set canonical');
say('');

let totalBad = 0;
let totalParBad = 0;
for (const camp of campaigns) {
  const levels = extract(camp.file);
  say(`== ${camp.name} — ${levels.length} levels ==`);
  say('lvl | par | opt |  expanded | status');
  let bad = 0, parBad = 0;
  levels.forEach((L, i) => {
    const tpl = baseTemplate(L, i);
    const budget = tpl.rows * tpl.cols * 40;
    const t0 = Date.now();
    const res = solveLevel(tpl, budget);
    const ms = Date.now() - t0;
    const parOk = res.ok && res.pushes === L.par;
    if (!res.ok) { bad++; totalBad++; }
    if (parOk === false && res.ok) { parBad++; totalParBad++; }
    say(
      String(i + 1).padStart(3) + ' | ' +
      String(L.par).padStart(3) + ' | ' +
      (res.ok ? String(res.pushes) : '-').padStart(3) + ' | ' +
      String(res.expanded).padStart(9) + ' | ' +
      (res.ok ? (parOk ? 'SOLVABLE · par==opt ✓' : `SOLVABLE · par mismatch: stated ${L.par}, opt ${res.pushes} ~`) : `UNSOLVABLE ✗ (${res.reason})`) +
      `  ${ms}ms`,
    );
  });
  say(`--> ${camp.name}: ${levels.length - bad}/${levels.length} solvable with free tractor · ${parBad} par mismatch(es)`);
  say('');
}

/* sequential-progression invariant (data side): every level i has a successor
 * i+1 inside its own campaign; the shared shell unlocks min(idx+1, len-1). */
say('== SEQUENTIAL PROGRESSION CHECK ==');
for (const camp of campaigns) {
  const levels = extract(camp.file);
  const okSeq = levels.every((_, i) => i === levels.length - 1 || levels[i + 1] && levels[i + 1].ascii.length > 0);
  const okSizes = levels.every((L) => L.ascii.every((r) => r.length === L.ascii[0].length) && L.ascii.some((r) => r.includes('P')));
  say(`${camp.name}: ${levels.length} levels · next-always-exists ${okSeq ? '✓' : '✗'} · rectangular+player-start ${okSizes ? '✓' : '✗'}`);
}
say('');
say(totalBad === 0
  ? `RESULT: ALL LEVELS SOLVABLE WITH THE FREE TRACTOR ✓${totalParBad ? ` (${totalParBad} par value(s) to tighten)` : ''}`
  : `RESULT: ${totalBad} UNSOLVABLE LEVEL(S) — LEVEL DATA MUST BE FIXED ✗`);

writeFileSync(OUT, lines.join('\n') + '\n');
console.log('\nwritten →', OUT);
