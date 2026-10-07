#!/usr/bin/env bun
/**
 * Boulder Yard level verifier — tool-results/boulder-solver.mjs (QA, not shipped).
 *
 * For every level in src/lib/game/boulder-levels.ts:
 *   1. structural checks (rectangular, one player, boulders == targets)
 *   2. push-optimal BFS over (boulder-set, player-region) states
 *      with dead-square pruning (reverse pull-reachability from targets)
 *   3. par === optimal assertion
 *
 * Run:  bun tool-results/boulder-solver.mjs
 */
import { LEVELS } from '../src/lib/game/boulder-levels.ts';

const NODE_BUDGET = 600_000;

function parse(ascii) {
  const rows = ascii.length;
  const cols = Math.max(...ascii.map((r) => r.length));
  const grid = ascii.map((r) => r.padEnd(cols, ' '));
  let player = -1;
  const boulders = [];
  const targets = new Set();
  const wall = new Array(rows * cols).fill(true);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const i = r * cols + c;
      if (ch === ' ') continue; // void stays wall
      wall[i] = false;
      if (ch === '#') wall[i] = true;
      else {
        wall[i] = false;
        if (ch === 'B' || ch === '*') boulders.push(i);
        if (ch === 'T' || ch === '*') targets.add(i);
        if (ch === 'P') player = i;
      }
      if (ch === '#') wall[i] = true;
    }
  }
  return { rows, cols, wall, boulders, targets, player };
}

function strides(cols) {
  return [
    { d: 'up', dv: -cols },
    { d: 'down', dv: cols },
    { d: 'left', dv: -1 },
    { d: 'right', dv: 1 },
  ];
}

/** Squares from which a boulder can still reach some target (reverse pull BFS). */
function aliveSquares(p) {
  const ok = new Array(p.rows * p.cols).fill(false);
  const q = [];
  for (const t of p.targets) { ok[t] = true; q.push(t); }
  const S = strides(p.cols);
  while (q.length) {
    const cur = q.pop();
    for (const { dv } of S) {
      const from = cur - dv; // boulder one step "before" cur, pushed toward cur
      const behind = cur - 2 * dv; // player stands here
      if (from < 0 || from >= p.rows * p.cols) continue;
      if (behind < 0 || behind >= p.rows * p.cols) continue;
      if (ok[from] || p.wall[from] || p.wall[behind]) continue;
      ok[from] = true;
      q.push(from);
    }
  }
  return ok;
}

function solve(p) {
  const N = p.rows * p.cols;
  const S = strides(p.cols);
  const alive = aliveSquares(p);
  const b0 = [...p.boulders].sort((a, b) => a - b);
  const isWall = (i) => i < 0 || i >= N || p.wall[i];

  function playerReach(player, boulders) {
    const bset = new Set(boulders);
    const seen = new Uint8Array(N);
    const q = [player];
    seen[player] = 1;
    let min = player;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      if (cur < min) min = cur;
      for (const { dv } of S) {
        const nb = cur + dv;
        if (isWall(nb) || seen[nb] || bset.has(nb)) continue;
        seen[nb] = 1;
        q.push(nb);
      }
    }
    return { min, reach: seen };
  }

  const start = playerReach(p.player, b0);
  let frontier = [{ b: b0, region: start.min, reach: start.reach }];
  const seenGlobal = new Map();
  const key0 = b0.join(',') + '|' + start.min;
  seenGlobal.set(key0, 0);
  let pushes = 0;
  let nodes = 1;

  const onTarget = (b) => b.every((x) => p.targets.has(x));

  if (onTarget(b0)) return { optimal: 0, nodes: 1 };

  while (frontier.length) {
    pushes++;
    const next = [];
    for (const st of frontier) {
      const bset = new Set(st.b);
      for (let bi = 0; bi < st.b.length; bi++) {
        const b = st.b[bi];
        for (const { dv } of S) {
          const behind = b - dv;
          const ahead = b + dv;
          if (!st.reach[behind]) continue;
          if (isWall(ahead) || bset.has(ahead)) continue;
          if (!alive[ahead]) continue; // dead square — the boulder could never reach a target
          const nb = st.b.slice();
          nb[bi] = ahead;
          nb.sort((x, y) => x - y);
          const r = playerReach(b, nb); // player ends on the boulder's old cell
          const k = nb.join(',') + '|' + r.min;
          if (seenGlobal.has(k)) continue;
          seenGlobal.set(k, pushes);
          nodes++;
          if (nodes > NODE_BUDGET) return { optimal: -1, nodes, budget: true };
          if (onTarget(nb)) return { optimal: pushes, nodes };
          next.push({ b: nb, region: r.min, reach: r.reach });
        }
      }
    }
    frontier = next;
  }
  return { optimal: -1, nodes };
}

/* ------------------------------- run ------------------------------- */
let failures = 0;
const pars = [];
console.log(`Boulder Yard — verifying ${LEVELS.length} levels\n`);
console.log('lvl | par | optimal | nodes | status');
console.log('----+-----+---------+-------+-------');
for (let i = 0; i < LEVELS.length; i++) {
  const lvl = LEVELS[i];
  const p = parse(lvl.ascii);
  const errs = [];
  if (p.player < 0) errs.push('no player');
  if (p.boulders.length === 0) errs.push('no boulders');
  if (p.boulders.length !== p.targets.size) errs.push(`boulders(${p.boulders.length}) != targets(${p.targets.size})`);
  const width = lvl.ascii[0].length;
  if (!lvl.ascii.every((r) => r.length === width)) errs.push('ragged rows');
  if (p.rows > 9 || p.cols > 12) errs.push(`size ${p.cols}x${p.rows} exceeds 12x9`);
  let res = { optimal: -2, nodes: 0 };
  if (errs.length === 0) res = solve(p);
  const ok = errs.length === 0 && res.optimal >= 0 && res.optimal === lvl.par;
  if (!ok) failures++;
  const status = errs.length
    ? 'INVALID: ' + errs.join('; ')
    : res.optimal < 0
      ? (res.budget ? 'NODE BUDGET EXCEEDED' : 'UNSOLVABLE')
      : res.optimal === lvl.par ? 'OK' : `PAR MISMATCH (set ${res.optimal})`;
  pars.push(res.optimal >= 0 ? res.optimal : lvl.par);
  console.log(
    String(i + 1).padStart(3) + ' | ' +
    String(lvl.par).padStart(3) + ' | ' +
    String(res.optimal).padStart(7) + ' | ' +
    String(res.nodes).padStart(5) + ' | ' + status,
  );
}
console.log('\nOptimal pars:', JSON.stringify(pars));
console.log(failures === 0 ? '\nALL 24 LEVELS VERIFIED — par == optimal ✓' : `\n${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
