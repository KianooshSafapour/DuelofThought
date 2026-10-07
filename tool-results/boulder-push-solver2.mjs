#!/usr/bin/env node
/**
 * Push-optimal BFS solver for Boulder Yard 1+2 (QA tool, not shipped).
 * State: (boulder set, filled-pit set, canonical player position).
 * Cost: pushes (level-by-level BFS → optimal).
 * Supports pits (O) and one-way player gates (><^v).
 * Usage: node boulder-push-solver2.mjs <levels-file.ts>
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
  const wall = new Uint8Array(n);
  wall.fill(1);
  const targets = new Set();
  const pits = new Set();
  const gates = new Map();
  let boulders = new Set();
  let player = -1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const i = r * cols + c;
      if (ch === ' ') continue;
      if (ch === '#') { wall[i] = 1; continue; }
      wall[i] = 0;
      if (ch === 'B' || ch === '*') boulders.add(i);
      if (ch === 'T' || ch === '*') targets.add(i);
      if (ch === 'O') pits.add(i);
      if ('<>^v'.includes(ch)) gates.set(i, ch === '>' ? 'R' : ch === '<' ? 'L' : ch === '^' ? 'U' : 'D');
      if (ch === 'P') player = i;
    }
  }
  return { rows: rows.length, cols, wall, targets, pits, gates, boulders, player };
}

function reach(start, boulders, wall, gates, rows, cols, pits) {
  const n = rows * cols;
  const seen = new Uint8Array(n);
  const stack = [start];
  seen[start] = 1;
  let min = start;
  while (stack.length) {
    const cur = stack.pop();
    if (cur < min) min = cur;
    for (const [dv, checkRow] of [[-cols, false], [cols, false], [-1, true], [1, true]]) {
      const t = cur + dv;
      if (t < 0 || t >= n || seen[t] || wall[t] || boulders.has(t) || (pits && pits.has(t))) continue;
      if (checkRow && Math.floor(t / cols) !== Math.floor(cur / cols)) continue;
      const g = gates.get(t);
      if (g && ((dv === -1 && g !== 'L') || (dv === 1 && g !== 'R') || (dv === -cols && g !== 'U') || (dv === cols && g !== 'D'))) continue;
      seen[t] = 1;
      stack.push(t);
    }
  }
  return { seen, min };
}

function solve(p) {
  const { rows, cols, wall, targets, gates, pits } = p;
  const n = rows * cols;
  const startReach = reach(p.player, p.boulders, wall, gates, rows, cols, p.pits);

  const skey = (boulders, filled, canon) =>
    [...filled].sort((a, b) => a - b).join(',') + '#' + [...boulders].sort((a, b) => a - b).join(',') + '#' + canon;
  const win = (boulders) => {
    if (boulders.size === 0) return false; // engine rule: at least one boulder must remain, on a target
    for (const b of boulders) if (!targets.has(b)) return false;
    return true;
  };

  let layer = [{ boulders: p.boulders, filled: new Set(), canon: startReach.min }];
  const visited = new Set([skey(layer[0].boulders, layer[0].filled, layer[0].canon)]);

  for (let depth = 0; depth <= 100; depth++) {
    if (layer.length === 0) break;
    for (const st of layer) if (win(st.boulders)) return { ok: true, pushes: depth };
    const next = [];
    for (const st of layer) {
      const wall2 = wall.slice();
      for (const f of st.filled) wall2[f] = 0;
      const { seen } = reach(st.canon, st.boulders, wall2, gates, rows, cols, p.pits);
      for (const b of st.boulders) {
        for (const [dv, dname, rowCheck] of [[-cols, 'U', false], [cols, 'D', false], [-1, 'L', true], [1, 'R', true]]) {
          const back = b - dv;
          if (back < 0 || back >= n || !seen[back]) continue;
          if (rowCheck && Math.floor(back / cols) !== Math.floor(b / cols)) continue;
          const fwd = b + dv;
          if (fwd < 0 || fwd >= n || wall2[fwd]) continue;
          if (rowCheck && Math.floor(fwd / cols) !== Math.floor(b / cols)) continue;
          if (st.boulders.has(fwd)) continue;
          if (gates.has(fwd)) continue;
          const boulders2 = new Set(st.boulders);
          boulders2.delete(b);
          const filled2 = new Set(st.filled);
          if (pits.has(fwd)) filled2.add(fwd);
          else boulders2.add(fwd);
          if (boulders2.has(fwd) && !targets.has(fwd)) {
            // corner deadlock prune
            const up = fwd - cols, dn = fwd + cols, lf = fwd - 1, rt = fwd + 1;
            const upW = up < 0 || wall2[up] === 1, dnW = dn >= n || wall2[dn] === 1;
            const lfW = lf < 0 || Math.floor(lf / cols) !== Math.floor(fwd / cols) || wall2[lf] === 1;
            const rtW = rt >= n || Math.floor(rt / cols) !== Math.floor(fwd / cols) || wall2[rt] === 1;
            if ((upW && lfW) || (upW && rtW) || (dnW && lfW) || (dnW && rtW)) continue;
          }
          const wall3 = wall.slice();
          for (const f of filled2) wall3[f] = 0;
          const seedPos = boulders2.has(fwd) ? back : fwd; // a floor square we occupy post-push
          const openPits = new Set([...p.pits].filter((x) => !filled2.has(x)));
          const r2 = reach(seedPos, boulders2, wall3, gates, rows, cols, openPits);
          const k = skey(boulders2, filled2, r2.min);
          if (visited.has(k)) continue;
          visited.add(k);
          next.push({ boulders: boulders2, filled: filled2, canon: r2.min });
        }
      }
    }
    layer = next;
  }
  return { ok: false, pushes: -1 };
}

let failures = 0;
const pars = [];
console.log('lvl | par | optimal | status');
console.log('----+-----+---------+-------');
levels.forEach((L, i) => {
  const p = parse(L.rows);
  let res;
  try { res = solve(p); } catch (e) { res = { ok: false, pushes: -2, err: e.message }; }
  const bad = !res.ok || res.pushes !== L.par;
  if (bad) failures++;
  pars.push(res.pushes);
  console.log(String(i + 1).padStart(3), '|', String(L.par).padStart(3), '|', String(res.pushes).padStart(7), '|',
    !res.ok ? `UNSOLVABLE${res.err ? ' (' + res.err + ')' : ''} ✗` : res.pushes === L.par ? 'OK' : `PAR MISMATCH (set ${res.pushes})`);
});
console.log('\nOptimal pars:', JSON.stringify(pars));
console.log(failures === 0 ? 'ALL LEVELS VERIFIED ✓' : `${failures} FAILURE(S) ✗`);
