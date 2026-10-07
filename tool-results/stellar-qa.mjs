/**
 * Engine sanity QA for "Stellar Forge" — exercises the PURE engine in
 * src/lib/game/stellar-data.ts (no React): slide rules, merge scoring,
 * supernova detection, spawn, game-over detection, epochs, codex content.
 * Bun imports TypeScript natively.
 * Run: bun tool-results/stellar-qa.mjs
 */
import * as D from '../src/lib/game/stellar-data.ts';

let ok = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { ok++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}
const C = (r, c) => r * 5 + c;
let tileId = 1;
const mk = (level) => ({ id: tileId++, level });
const boardOf = (spec) => {
  const b = Array(30).fill(null);
  for (const [r, c, lvl] of spec) b[C(r, c)] = mk(lvl);
  return b;
};

console.log('— constants & chain —');
check('COLS=5 ROWS=6 CELLS=30', D.COLS === 5 && D.ROWS === 6 && D.CELLS === 30);
check('BASE_SPAWN=2 NOVA_SPAWN=3 BONUS=250 THROTTLE=150',
  D.BASE_SPAWN === 2 && D.NOVA_SPAWN === 3 && D.SUPERNOVA_BONUS === 250 && D.MOVE_THROTTLE_MS === 150);
check('chain H→He→C→O→Ne→Si→Fe',
  D.ELEMENTS.map((e) => e.symbol).join('→') === 'H→He→C→O→Ne→Si→Fe');

console.log('— merge scoring (level²×2) —');
check('He merge = 8', D.mergeScore(2) === 8);
check('C merge = 18', D.mergeScore(3) === 18);
check('O merge = 32', D.mergeScore(4) === 32);
check('Ne merge = 50', D.mergeScore(5) === 50);
check('Si merge = 72', D.mergeScore(6) === 72);
check('Fe merge = 98', D.mergeScore(7) === 98);

console.log('— slide: horizontal —');
{
  const b = boardOf([[0, 0, 1], [0, 1, 1]]); // [H H _ _ _]
  const r = D.slide(b, 'left');
  check('left merge H+H→He', r.board[C(0, 0)].level === 2 && r.board[C(0, 1)] === null);
  check('gained=8', r.gained === 8);
  check('forged[2]=1', r.forged[2] === 1);
  check('feForged=0', r.feForged === 0);
  check('merged flag on survivor', r.merged[C(0, 0)] === true);
}
{
  const b = boardOf([[0, 0, 1], [0, 1, 1], [0, 2, 1]]); // [H H H _ _]
  const r = D.slide(b, 'left');
  check('triple H → He+H (no cascade merge)', r.board[C(0, 0)].level === 2 && r.board[C(0, 1)].level === 1 && r.gained === 8);
}
{
  const b = boardOf([[0, 0, 2], [0, 1, 2]]); // [He He _ _ _]
  const r = D.slide(b, 'right');
  check('right merge He+He→C at wall', r.board[C(0, 4)].level === 3 && r.gained === 18);
  check('maxMergedLevel=3', r.maxMergedLevel === 3);
}
{
  // immovable up/left: col0 packed at top (H,C,Ne distinct), row0 packed at left (H,He,O distinct)
  const b = boardOf([[0, 0, 1], [0, 1, 2], [0, 2, 4], [1, 0, 3], [2, 0, 5]]);
  check('up/left invalid on top-left-compacted board', D.slide(b, 'up') === null && D.slide(b, 'left') === null);
}

console.log('— slide: vertical —');
{
  const b = boardOf([[0, 0, 1], [1, 0, 1]]);
  const r = D.slide(b, 'up');
  check('up merge H+H→He at top', r.board[C(0, 0)].level === 2 && r.board[C(1, 0)] === null);
  const r2 = D.slide(b, 'down');
  check('down merge He at bottom', r2.board[C(5, 0)].level === 2);
}

console.log('— supernova (Fe forged) —');
{
  const b = boardOf([[5, 0, 6], [5, 1, 6]]); // Si Si
  const r = D.slide(b, 'left');
  check('Si+Si→Fe detected', r.board[C(5, 0)].level === 7 && r.feForged === 1);
  check('Fe merge score 98', r.gained === 98);
  // two independent Fe merges in one move
  const b2 = boardOf([[0, 0, 6], [0, 1, 6], [2, 0, 6], [2, 1, 6]]);
  const r2 = D.slide(b2, 'left');
  check('two Fe in one move → feForged=2', r2.feForged === 2);
}

console.log('— spawn & game over —');
{
  // FULL board (30 tiles), no two adjacent tiles share a level → dead position
  const spec = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) spec.push([r, c, ((c + r * 3) % 7) + 1]);
  const full = boardOf(spec);
  let n = 100;
  const nextId = () => n++;
  const sp = D.spawnRandom(full, 2, nextId);
  check('spawn into full board spawns nothing', sp.spawned.length === 0);
  check('game over on dead full board', D.hasMoves(full) === false && D.slide(full, 'up') === null && D.slide(full, 'down') === null && D.slide(full, 'left') === null && D.slide(full, 'right') === null);
  const alive = full.slice(); alive[C(0, 1)] = mk(1);
  check('alive when equal neighbours exist', D.hasMoves(alive) === true);
  const withEmpty = full.slice(); withEmpty[C(5, 4)] = null;
  check('alive when any empty cell', D.hasMoves(withEmpty) === true);
  const sp2 = D.spawnRandom(D.initialBoard(), 2, nextId);
  check('spawn respects n=2 into empty cells', sp2.spawned.length === 2 && sp2.spawned.every((s) => sp2.board[s.index].level === 1));
  check('initialBoard deterministic (2 H, hydration-safe)',
    D.initialBoard().filter(Boolean).length === 2 && D.initialBoard()[7].level === 1 && D.initialBoard()[16].level === 1);
}

console.log('— epochs —');
check('0→Protostar', D.epochForScore(0).id === 'protostar');
check('499→Protostar / 500→Main Sequence', D.epochForScore(499).id === 'protostar' && D.epochForScore(500).id === 'main_sequence');
check('1199→Main / 1200→Red Giant', D.epochForScore(1199).id === 'main_sequence' && D.epochForScore(1200).id === 'red_giant');
check('1999→Red Giant / 2000→Supergiant', D.epochForScore(1999).id === 'red_giant' && D.epochForScore(2000).id === 'supergiant');

console.log('— codex content —');
check('7 elements bilingual + blurb + palette',
  D.ELEMENTS.every((e) => e.fa && e.en && e.blurbFa && e.blurbEn && e.light && e.mid && e.deep && e.ink && e.glow));
check('palettes per spec (H sky / He gold / C silver-blue / O emerald / Ne magenta / Si orange / Fe red)',
  D.ELEMENTS[0].mid === '#7dd3fc' && D.ELEMENTS[1].mid === '#fde68a' && D.ELEMENTS[2].mid === '#a5b4fc' &&
  D.ELEMENTS[3].mid === '#6ee7b7' && D.ELEMENTS[4].mid === '#f0abfc' && D.ELEMENTS[5].mid === '#fdba74' &&
  D.ELEMENTS[6].mid === '#f87171');
check('5 life stages (H→He→C/O→Si→collapse)', D.STAGES.length === 5);
check('Burbidge et al. 1957 credit', D.CODEX_CREDIT.includes('Burbidge') && D.CODEX_CREDIT.includes('1957'));
check('codex science: triple-alpha / p-p chain / nickel-56 / collapse',
  /triple-alpha/i.test(D.ELEMENTS[2].blurbEn) && /proton–proton/i.test(D.ELEMENTS[1].blurbEn)
  && /nickel-56/i.test(D.STAGES[3].blurbEn) && /collapse/i.test(STAGE5()));
function STAGE5() { return D.STAGES[4].blurbEn; }

console.log(`\nRESULT: ${ok} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
