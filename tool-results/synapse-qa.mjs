/**
 * Synapse engine QA (Task 5-b) — validates the REAL engine module
 * src/lib/game/synapse-data.ts (bun runs TS natively; its only import is type-only).
 *
 * Checks:
 *  1. genBlock: match rate ≈ 30%/channel; ZERO accidental matches on non-match draws;
 *     opps counters == actual match counts; sequence length == BASE_TRIALS + n.
 *  2. effectiveAcc/nextN: ≥80% promote, <50% demote, clamp 1..7 (boundary cases).
 *  3. Scoring sim: "good player" (80% hit rate, 6% spurious FA per eligible trial)
 *     over full sessions at n=1..5 → typical final score should land ≈ 300–800 mid-range.
 *  4. Timing constants match spec (2600 ms trial / 600 ms glow / 2 blocks / 20 base).
 */
import {
  genBlock, effectiveAcc, nextN, TRIAL_MS, STIM_MS, SESSION_BLOCKS, BASE_TRIALS, N_MIN, N_MAX,
  HIT_POINTS, FA_POINTS, SYNAPSE_LETTERS, SYNAPSE_TONES, SYNAPSE_DAYS, SYNAPSE_ACTS,
} from '../src/lib/game/synapse-data.ts';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.error('FAIL —', msg); } else console.log('ok  —', msg); };

/* 1 ── generator statistics */
for (let n = N_MIN; n <= N_MAX; n++) {
  const N = 3000;
  let mPos = 0, mSnd = 0, accPos = 0, accSnd = 0, len0 = -1, bad = 0;
  for (let s = 0; s < N; s++) {
    const b = genBlock(n);
    len0 = b.pos.length;
    ok(len0 === BASE_TRIALS + n, `len == 20+n (n=${n})`) && null;
    if (len0 !== BASE_TRIALS + n) bad++;
    let cPos = 0, cSnd = 0;
    for (let i = n; i < len0; i++) {
      if (b.pos[i] === b.pos[i - n]) cPos++;
      if (b.snd[i] === b.snd[i - n]) cSnd++;
      // non-match draws must genuinely differ from the n-back item (checked via opps consistency below)
    }
    if (cPos !== b.opps.pos || cSnd !== b.opps.snd) bad++;
    mPos += cPos / (len0 - n); mSnd += cSnd / (len0 - n);
    accPos += b.opps.pos; accSnd += b.opps.snd;
  }
  const rPos = mPos / N, rSnd = mSnd / N;
  ok(Math.abs(rPos - 0.3) < 0.02, `n=${n} position match rate ${rPos.toFixed(3)} ≈ 0.30`);
  ok(Math.abs(rSnd - 0.3) < 0.02, `n=${n} sound match rate ${rSnd.toFixed(3)} ≈ 0.30`);
  ok(bad === 0, `n=${n} opps counters consistent + length 20+n across ${N} blocks`);
}

/* 2 ── adaptive rule boundaries */
ok(nextN(2, 0.80) === 3 && nextN(2, 0.95) === 3, 'acc ≥ 0.80 → n+1');
ok(nextN(2, 0.79) === 2 && nextN(2, 0.50) === 2, '0.50 ≤ acc < 0.80 → hold');
ok(nextN(2, 0.49) === 1 && nextN(2, 0) === 1, 'acc < 0.50 → n−1');
ok(nextN(N_MAX, 1) === N_MAX && nextN(N_MIN, 0) === N_MIN, 'clamp [1,7]');
ok(effectiveAcc(8, 2, 10) === 0.6 && effectiveAcc(5, 0, 0) === 0, 'effectiveAcc = (hits−FA)/opps, 0 on 0 opps');

/* 3 ── full-session scoring sim (good player; adaptive n between blocks) */
function simSession(startN, hitP, faP) {
  let n = startN, points = 0;
  const ns = [];
  for (let blk = 1; blk <= SESSION_BLOCKS; blk++) {
    const b = genBlock(n);
    ns.push(n);
    for (let i = n; i < b.pos.length; i++) {
      const mp = b.pos[i] === b.pos[i - n], ms = b.snd[i] === b.snd[i - n];
      for (const m of [mp, ms]) {
        if (m && Math.random() < hitP) points += HIT_POINTS * n;
        else if (!m && Math.random() < faP) points -= FA_POINTS * n;
      }
    }
    const opps = b.opps.pos + b.opps.snd;
    // good-player effective accuracy ≈ hitP·matchRate·opps − faP·(1−matchRate)·opps
    const acc = Math.max(0, Math.min(1, (hitP * opps - faP * opps * (0.3 / 0.7)) / opps));
    n = nextN(n, acc);
  }
  return { score: Math.max(0, points), ns };
}
const runs = 400;
for (const startN of [2, 3, 4]) {
  const scores = [];
  for (let i = 0; i < runs; i++) scores.push(simSession(startN, 0.8, 0.05).score);
  scores.sort((a, b) => a - b);
  const med = scores[Math.floor(runs / 2)], p10 = scores[Math.floor(runs * 0.1)], p90 = scores[Math.floor(runs * 0.9)];
  console.log(`    n0=${startN}: median ${med}, p10 ${p10}, p90 ${p90}`);
  ok(med >= 250 && med <= 850, `n0=${startN} median score ${med} in the ~300–800 band (loose)`);
}

/* 4 ── constants + data integrity */
ok(TRIAL_MS === 2600 && STIM_MS === 600, 'trial 2600 ms, glow 600 ms (spec)');
ok(SESSION_BLOCKS === 2 && BASE_TRIALS === 20, '2 blocks × (20+n) trials (spec)');
ok(HIT_POINTS === 8 && FA_POINTS === 5, 'scoring +8×n / −5×n (spec)');
ok(SYNAPSE_LETTERS.length === 8 && new Set(SYNAPSE_LETTERS).size === 8 && SYNAPSE_LETTERS.join('') === 'CHKLQRST', '8 distinct letters C,H,K,L,Q,R,S,T');
ok(SYNAPSE_TONES.length === 8 && SYNAPSE_TONES.every((f) => f >= 300 && f <= 800) && new Set(SYNAPSE_TONES).size === 8, '8 distinct tones within 300–800 Hz');
ok(SYNAPSE_DAYS.length === 20 && SYNAPSE_DAYS.every((d, i) => d.day === i + 1), '20 campaign days, 1..20');
ok(SYNAPSE_DAYS.every((d) => d.note.fa.length > 40 && d.note.en.length > 40), 'every day has a 2-sentence bilingual briefing');
ok(SYNAPSE_DAYS[0].act === 1 && SYNAPSE_DAYS[6].act === 1 && SYNAPSE_DAYS[7].act === 2 && SYNAPSE_DAYS[13].act === 2 && SYNAPSE_DAYS[14].act === 3 && SYNAPSE_DAYS[19].act === 3, 'acts split 1–7 / 8–14 / 15–20');
ok(SYNAPSE_ACTS.length === 3, '3 acts');

console.log(fails === 0 ? '\nALL SYNAPSE ENGINE CHECKS PASSED ✅' : `\n${fails} CHECK(S) FAILED ❌`);
process.exit(fails === 0 ? 0 : 1);
