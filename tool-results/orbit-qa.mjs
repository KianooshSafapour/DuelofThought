/**
 * QA beatability sweep for Orbit Odyssey (task 5-a).
 * Grid-searches launch angles/powers per mission with the EXACT flight physics,
 * then (for stubborn missions) a naive "always thrust toward target" bot.
 * Run: bun tool-results/orbit-qa.mjs
 */
import { MISSIONS, DT, stepProbe, hitsBody, outOfBounds, MAX_DRAG, LAUNCH_SCALE, LAUNCH_FUEL_PER_DV, THRUST_ACCEL, TIME_LIMIT } from '../src/lib/game/orbit-missions.ts';

const STEPS = Math.ceil((TIME_LIMIT + 30) * 60); // flight can run past the limit check? limit fires at TIME_LIMIT — use exact
const LIM = Math.ceil(TIME_LIMIT * 60);

function flight(m, vx0, vy0, bot) {
  // returns {status, pods, steps}
  const p = { x: m.start.x, y: m.start.y, vx: vx0, vy: vy0 };
  let fuel = m.startFuel;
  const pods = m.pods.map(() => false);
  for (let i = 0; i < LIM; i++) {
    let tx = 0, ty = 0;
    if (bot && fuel > 0) {
      const dx = m.target.x - p.x, dy = m.target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      // burn only when heading roughly toward target OR falling behind schedule (naive)
      tx = (dx / d) * THRUST_ACCEL; ty = (dy / d) * THRUST_ACCEL;
      fuel = Math.max(0, fuel - 12 * DT);
    }
    stepProbe(p, m.bodies, DT, tx, ty);
    for (let k = 0; k < m.pods.length; k++) {
      if (!pods[k] && Math.hypot(p.x - m.pods[k].x, p.y - m.pods[k].y) < 26) pods[k] = true;
    }
    if (Math.hypot(p.x - m.target.x, p.y - m.target.y) < m.target.r) return { status: 'capture', pods: pods.filter(Boolean).length, steps: i };
    if (hitsBody(p.x, p.y, m.bodies)) return { status: 'crash', pods: pods.filter(Boolean).length, steps: i };
    if (outOfBounds(p.x, p.y)) return { status: 'oob', pods: pods.filter(Boolean).length, steps: i };
  }
  return { status: 'timeout', pods: pods.filter(Boolean).length, steps: LIM };
}

const maxDv = MAX_DRAG * LAUNCH_SCALE; // 38.4
let allOk = true;
for (const m of MISSIONS) {
  let best = null;
  // ballistic grid: 240 angles × 12 power levels (fuel-limited)
  const dvCap = Math.min(maxDv, m.startFuel / LAUNCH_FUEL_PER_DV);
  const powers = [];
  for (let k = 1; k <= 12; k++) powers.push((dvCap * k) / 12);
  outer:
  for (let a = 0; a < 240; a++) {
    const ang = (a * Math.PI) / 120;
    for (const dv of powers) {
      const r = flight(m, Math.cos(ang) * dv, Math.sin(ang) * dv, false);
      const sc = (r.status === 'capture' ? 1000 : 0) + r.pods * 10 - r.steps / 1000;
      if (!best || sc > best.sc) best = { sc, r, ang: (ang * 180) / Math.PI, dv };
      if (r.status === 'capture' && r.pods === m.pods.length) break outer;
    }
  }
  let mode = 'ballistic';
  if (best?.r.status !== 'capture') {
    // thrust bot sweep: launch at best ballistic-ish angles + always-burn
    for (let a = 0; a < 120 && best?.r.status !== 'capture'; a++) {
      const ang = (a * Math.PI) / 60;
      for (const dv of powers) {
        const r = flight(m, Math.cos(ang) * dv, Math.sin(ang) * dv, true);
        const sc = (r.status === 'capture' ? 1000 : 0) + r.pods * 10 - r.steps / 1000;
        if (!best || sc > best.sc) { best = { sc, r, ang: (ang * 180) / Math.PI, dv }; mode = 'bot'; }
        if (r.status === 'capture') break;
      }
    }
  }
  const ok = best?.r.status === 'capture';
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'} m${String(MISSIONS.indexOf(m) + 1).padStart(2, '0')} ${m.id} (${mode}) → ${best?.r.status} pods=${best?.r.pods}/${m.pods.length} angle=${best?.ang.toFixed(0)}° dv=${best?.dv.toFixed(1)} t=${(best?.r.steps / 60).toFixed(1)}s`);
}
console.log(allOk ? '\nALL 12 MISSIONS BEATABLE ✓' : '\nSOME MISSIONS FAILED ✗');
