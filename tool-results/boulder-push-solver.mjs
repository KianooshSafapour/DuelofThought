#!/usr/bin/env node
/**
 * Push-optimal BFS solver for Boulder Yard 1+2 (QA tool, not shipped).
 * State: (boulder set, canonical player-region). Cost: pushes (uniform).
 * Supports pits (O) and one-way player gates (><^v) for game 2.
 * Usage: node boulder-push-solver.mjs <levels-file.ts> [--json]
 */
import { readFileSync } from 'fs';

const file = process.argv[2];
const srcTxt = readFileSync(file, 'utf8');
const blocks = [...srcTxt.matchAll(/\{ par: (\d+), ascii: \[(.*?)\]\s*\}/gs)];
const levels = blocks.map((m) => ({
  par: Number(m[1]),
  rows: [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]),
}));

function parse(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => r.padEnd(cols, ' '));
  const n = rows.length * cols;
  const wall = new Array(n).fill(true);
  const targets = new Set();
  const pits = new Map(); // idx -> true (open pit)
  const gates = new Map(); // idx -> dir letter
  let boulders = new Set();
  let player = -1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const i = r * cols + c;
      if (ch === ' ') continue;
      wall[i] = false;
      if (ch === '#') wall[i] = true;
      if (ch === 'B' || ch === '*') boulders.add(i);
      if (ch === 'T' || ch === '*') targets.add(i);
      if (ch === 'O') pits.set(i, true);
      if ('<>^v'.includes(ch)) gates.set(i, ch);
      if (ch === 'P') player = i;
    }
  }
  return { rows: rows.length, cols, wall, targets, pits, gates, boulders, player };
}

const DELTAS = { U: (c) => -c, D: (c) => c, L: () => -1, R: () => 1 };

function solve(p) {
  const { rows, cols, wall, targets, pits, gates } = p;
  const n = rows * cols;
  const sameRow = (a, b) => Math.floor(a / cols) === Math.floor(b / cols);

  function reachable(player, boulders) {
    // flood fill player positions
    const seen = new Uint8Array(n);
    const q = [player];
    seen[player] = 1;
    const list = [player];
    while (q.length) {
      const cur = q.pop();
      for (const d of ['U', 'D', 'L', 'R']) {
        const t = cur + DELTAS[d](cols);
        if (t < 0 || t >= n || seen[t] || wall[t] || boulders.has(t)) continue;
        if ((d === 'L' || d === 'R') && !sameRow(t, cur)) continue;
        const g = gates.get(t);
        if (g && g !== d) continue; // one-way gate: passable only in arrow dir
        seen[t] = 1;
        q.push(t);
        list.push(t);
      }
    }
    return { seen, canon: Math.min(...list) };
  }

  const start = reachable(p.player, p.boulders);
  const initial = { boulders: p.boulders, canon: start.canon };
  const keyOf = (st) => st.canon + '|' + [...st.boulders].sort((a, b) => a - b).join(',');
  const parent = new Map([[keyOf(initial), null]]);
  let layer = [initial];
  const MAXD = 80;
  for (let depth = 0; depth <= MAXD; depth++) {
    // check victory
    for (const st of layer) {
      if (st.boulders.size === 0) return { pushes: depth, ok: true, reason: 'all swallowed' };
      let all = true;
      for (const b of st.boulders) if (!targets.has(b)) { all = false; break; }
      if (all) return { pushes: depth, ok: true };
    }
    const next = [];
    for (const st of layer) {
      const { seen } = reachable(st.canon, st.boulders); // any square in region works (canon is in region)
      for (const b of st.boulders) {
        for (const d of ['U', 'D', 'L', 'R']) {
          const back = b - DELTAS[d](cols);
          if (back < 0 || back >= n || !seen[back]) continue;
          if ((d === 'L' || d === 'R') && !sameRow(back, b)) continue;
          const fwd = b + DELTAS[d](cols);
          if (fwd < 0 || fwd >= n || wall[fwd]) continue;
          if ((d === 'L' || d === 'R') && !sameRow(fwd, b)) continue;
          if (st.boulders.has(fwd)) continue;
          if (gates.has(fwd)) continue; // boulders never pass gates
          const boulders2 = new Set(st.boulders);
          boulders2.delete(b);
          const pits2 = null; // pits tracked per-state below
          let extra = {};
          if (pits.has(fwd)) {
            extra.filledPit = fwd; // pit becomes floor
          } else {
            boulders2.add(fwd);
          }
          // quick corner-deadlock prune (unless on target / swallowed)
          if (boulders2.has(fwd) && !targets.has(fwd)) {
            const up = fwd - cols, dn = fwd + cols;
            const upWall = up < 0 || wall[up], dnWall = dn >= n || wall[dn];
            const lfWall = !sameRow(fwd, fwd - 1) || wall[fwd - 1], rtWall = !sameRow(fwd, fwd + 1) || wall[fwd + 1];
            if ((upWall && lfWall) || (upWall && rtWall) || (dnWall && lfWall) || (dnWall && rtWall)) continue;
          }
          const st2 = { boulders: boulders2, canon: st.canon, filled: [...(st.filled || []), ...(extra.filledPit ? [extra.filledPit] : [])] };
          // recompute canon with filled pits as floor
          const wall2 = wall.slice();
          for (const f of st2.filled) wall2[f] = false;
          const p2 = pits2 === null ? { ...p, wall: wall2 } : p;
          const rr = reachable(st2.canon, st2.boulders);
          // NOTE: canon computed from old region may be a filled pit — recompute properly:
          const canon2 = Math.min(...playerReach(st2.canon, st2.boulders, wall2, gates, rows, cols).list);
          const k = canon2 + '|' + [...st2.boulders].sort((a, b) => a - b).join(',') + '|' + [...(st2.filled || [])].sort((a, b) => a - b).join(',');
          if (!parent.has(k)) {
            parent.set(k, { prev: keyOf(st), push: { from: b, dir: d } });
            st2.canon = canon2; st2._k = k;
            next.push(st2);
          }
        }
      }
    }
    layer = next;
  }
  return { ok: false, pushes: -1 };
}

// standalone player-reachability with custom wall array (handles filled pits)
function playerReach(start, boulders, wall, gates, rows, cols) {
  const n = rows * cols;
  const seen = new Uint8Array(n);
  const q = [start]; seen[start] = 1; const list = [start];
  while (q.length) {
    const cur = q.pop();
    for (const d of ['U', 'D', 'L', 'R']) {
      const t = cur + DELTAS[d](cols);
      if (t < 0 || t >= n || seen[t] || wall[t] || boulders.has(t)) continue;
      if ((d === 'L' || d === 'R') && Math.floor(t / cols) !== Math.floor(cur / cols)) continue;
      const g = gates.get(t);
      if (g && g !== d) continue;
      seen[t] = 1; q.push(t); list.push(t);
    }
  }
  return { seen, list };
}

let failures = 0;
const pars = [];
console.log('lvl | par | optimal | status');
console.log('----+-----+---------+-------');
levels.forEach((L, i) => {
  const p = parse(L.rows);
  const res = solve(p);
  const ok = res.ok && res.pushes === L.par;
  if (!res.ok || res.pushes !== L.par) failures++;
  pars.push(res.pushes);
  console.log(
    String(i + 1).padStart(3),
    '|', String(L.par).padStart(3),
    '|', String(res.pushes).padStart(7),
    '|', !res.ok ? 'UNSOLVABLE ✗' : res.pushes === L.par ? 'OK' : `PAR MISMATCH (set ${res.pushes})`,
  );
});
console.log('\nOptimal pars:', JSON.stringify(pars));
console.log(failures === 0 ? 'ALL LEVELS VERIFIED ✓' : `${failures} FAILURE(S) ✗`);
process.exit(failures === 0 ? 0 : 1);
