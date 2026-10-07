/**
 * QA harness (dev-only, not shipped): auto-solve every Orbit Odyssey mission to prove
 * beatability. Uses the EXACT physics exported by src/lib/game/orbit-missions.ts.
 *
 * Policies:
 *   A — ballistic grid (angle × speed), no thrust.
 *   B — ballistic grid + always thrust toward target while fuel lasts.
 *   C — coast to periapsis of the dominant body, then burn toward target (Oberth policy).
 * Run: bun tool-results/orbit-verify.ts
 */
import { MISSIONS, stepProbe, DT, TIME_LIMIT, THRUST_ACCEL, FUEL_BURN, WORLD, OOB_MARGIN, Body, Mission } from '../src/lib/game/orbit-missions';

type Outcome = 'win' | 'crash' | 'oob' | 'timeout';

function simulate(m: Mission, vx0: number, vy0: number, policy: 'A' | 'B' | 'C', coastSteps = 0): { out: Outcome; minTargetDist: number; steps: number } {
  const p = { x: m.start.x, y: m.start.y, vx: vx0, vy: vy0 };
  let fuel = m.startFuel;
  const maxSteps = Math.ceil(TIME_LIMIT / DT);
  let minD = Infinity;
  for (let i = 0; i < maxSteps; i++) {
    let tx = 0;
    let ty = 0;
    if (policy !== 'A' && fuel > 0 && (policy === 'B' || i >= coastSteps)) {
      const dx = m.target.x - p.x;
      const dy = m.target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      tx = (dx / d) * THRUST_ACCEL;
      ty = (dy / d) * THRUST_ACCEL;
      fuel -= FUEL_BURN * DT;
    }
    stepProbe(p, m.bodies, DT, tx, ty);
    const td = Math.hypot(p.x - m.target.x, p.y - m.target.y);
    if (td < minD) minD = td;
    if (td < m.target.r) return { out: 'win', minTargetDist: minD, steps: i };
    for (const b of m.bodies) {
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 4) return { out: 'crash', minTargetDist: minD, steps: i };
    }
    const mx = WORLD.w * OOB_MARGIN;
    const my = WORLD.h * OOB_MARGIN;
    if (p.x < -mx || p.x > WORLD.w + mx || p.y < -my || p.y > WORLD.h + my) return { out: 'oob', minTargetDist: minD, steps: i };
  }
  return { out: 'timeout', minTargetDist: minD, steps: maxSteps };
}

function dominantBody(m: Mission): Body {
  return m.bodies.reduce((a, b) => (b.gm > a.gm ? b : a));
}

/** Periapsis step of a ballistic dive aimed roughly at the dominant body. */
function periapsisStep(m: Mission, vx0: number, vy0: number): number {
  const dom = dominantBody(m);
  const p = { x: m.start.x, y: m.start.y, vx: vx0, vy: vy0 };
  let best = { d: Infinity, step: 0 };
  const maxSteps = Math.ceil(TIME_LIMIT / DT);
  for (let i = 0; i < maxSteps; i++) {
    stepProbe(p, m.bodies, DT, 0, 0);
    if (Math.hypot(p.x - dom.x, p.y - dom.y) < dom.r + 4) break;
    const d = Math.hypot(p.x - dom.x, p.y - dom.y);
    if (d < best.d) best = { d, step: i };
    const mx = WORLD.w * OOB_MARGIN;
    const my = WORLD.h * OOB_MARGIN;
    if (p.x < -mx || p.x > WORLD.w + mx || p.y < -my || p.y > WORLD.h + my) break;
  }
  return best.step;
}

function search(m: Mission) {
  const dom = dominantBody(m);
  const results: string[] = [];
  let bestEver = { d: Infinity, policy: '', v: '' };
  let wins = { A: 0, B: 0, C: 0 };
  let solution: string | null = null;

  const toDom = Math.atan2(dom.y - m.start.y, dom.x - m.start.x);

  for (let angDeg = 0; angDeg < 360; angDeg += 5) {
    const ang = (angDeg * Math.PI) / 180;
    for (let spd = 6; spd <= 38; spd += 2) {
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      const a = simulate(m, vx, vy, 'A');
      if (a.minTargetDist < bestEver.d) bestEver = { d: a.minTargetDist, policy: 'A', v: `${angDeg}°@${spd}` };
      if (a.out === 'win') { wins.A++; if (!solution) solution = `A ${angDeg}° @ ${spd} u/s`; }
      const b = simulate(m, vx, vy, 'B');
      if (b.minTargetDist < bestEver.d) bestEver = { d: b.minTargetDist, policy: 'B', v: `${angDeg}°@${spd}` };
      if (b.out === 'win') { wins.B++; if (!solution) solution = `B ${angDeg}° @ ${spd} u/s`; }
    }
    // policy C: only launch directions near the dominant body (±75°), Oberth dives
    for (let off = -75; off <= 75; off += 15) {
      const ang = toDom + (off * Math.PI) / 180;
      for (let spd = 8; spd <= 38; spd += 2.5) {
        const vx = Math.cos(ang) * spd;
        const vy = Math.sin(ang) * spd;
        const ps = periapsisStep(m, vx, vy);
        const c = simulate(m, vx, vy, 'C', ps);
        if (c.minTargetDist < bestEver.d) bestEver = { d: c.minTargetDist, policy: 'C', v: `${angDeg}+${off}°@${spd}` };
        if (c.out === 'win') { wins.C++; if (!solution) solution = `C ${angDeg}+${off}° @ ${spd} u/s (coast ${ps})`; }
      }
    }
  }
  return { ok: solution !== null, detail: `wins A=${wins.A} B=${wins.B} C=${wins.C} | closest approach ${bestEver.d.toFixed(0)}u (${bestEver.policy} ${bestEver.v}) | first: ${solution ?? 'NONE'}` };
}

let allOk = true;
for (const m of MISSIONS) {
  const { ok, detail } = search(m);
  if (!ok) allOk = false;
  console.log(`${m.id} ${ok ? '✔' : '✘✘✘ UNBEATABLE ✘✘✘'}  ${detail}`);
}
console.log(allOk ? 'ALL 12 MISSIONS BEATABLE ✔' : 'SOME MISSIONS FAILED ✘');
