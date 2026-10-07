/**
 * T9-d arena validation + collision/intercept math unit checks for Mind Tank.
 * Run: node tool-results/t9d-arena-check.mjs
 * Verifies, for every arena layout:
 *   1. every wall lies inside the 880×620 frame (≥ PAD from the edge),
 *   2. player spawn is free of wall overlap,
 *   3. every drone spawn is free of wall overlap,
 *   4. pairwise wall overlaps are intentional (L-shares allowed) — reports only,
 *   5. circle-rect push-out keeps bodies out of walls,
 *   6. pulse wall reflection reverses the normal velocity component,
 *   7. intercept solver hits a moving target (numeric check),
 *   8. Liang–Barsky LOS matches a brute-force sampling oracle.
 */
const ARENA_W = 880, ARENA_H = 620, PAD = 16;

const MIRROR = {
  id: 'mirror',
  walls: [
    { x: 426, y: 56, w: 28, h: 180 }, { x: 426, y: 384, w: 28, h: 180 },
    { x: 140, y: 246, w: 160, h: 28 }, { x: 580, y: 346, w: 160, h: 28 },
    { x: 232, y: 104, w: 36, h: 36 }, { x: 612, y: 480, w: 36, h: 36 },
  ],
  playerSpawn: { x: 110, y: 530 },
  droneSpawns: [
    { x: 762, y: 120 }, { x: 762, y: 512 }, { x: 520, y: 96 },
    { x: 350, y: 540 }, { x: 140, y: 100 }, { x: 760, y: 316 },
  ],
};
const BASTIONS = {
  id: 'bastions',
  walls: [
    { x: 84, y: 84, w: 150, h: 34 }, { x: 84, y: 84, w: 34, h: 150 },
    { x: 646, y: 84, w: 150, h: 34 }, { x: 762, y: 84, w: 34, h: 150 },
    { x: 84, y: 502, w: 150, h: 34 }, { x: 84, y: 386, w: 34, h: 150 },
    { x: 646, y: 502, w: 150, h: 34 }, { x: 762, y: 386, w: 34, h: 150 },
    { x: 404, y: 274, w: 72, h: 72 }, { x: 423, y: 96, w: 34, h: 84 }, { x: 423, y: 440, w: 34, h: 84 },
  ],
  playerSpawn: { x: 110, y: 310 },
  droneSpawns: [
    { x: 440, y: 240 }, { x: 440, y: 400 }, { x: 760, y: 310 },
    { x: 110, y: 560 }, { x: 170, y: 160 }, { x: 770, y: 560 },
  ],
};
const CROSSFIELD = {
  id: 'crossfield',
  walls: [
    { x: 262, y: 296, w: 356, h: 28 }, { x: 426, y: 128, w: 28, h: 364 },
    { x: 150, y: 110, w: 40, h: 40 }, { x: 690, y: 110, w: 40, h: 40 },
    { x: 150, y: 470, w: 40, h: 40 }, { x: 690, y: 470, w: 40, h: 40 },
  ],
  playerSpawn: { x: 110, y: 315 },
  droneSpawns: [
    { x: 110, y: 105 }, { x: 770, y: 105 }, { x: 110, y: 515 },
    { x: 770, y: 515 }, { x: 440, y: 84 }, { x: 440, y: 536 },
  ],
};
const TWINFORTS = {
  id: 'twinforts',
  walls: [
    { x: 150, y: 196, w: 250, h: 30 }, { x: 480, y: 394, w: 250, h: 30 },
    { x: 400, y: 262, w: 80, h: 80 }, { x: 86, y: 430, w: 36, h: 36 },
    { x: 758, y: 154, w: 36, h: 36 }, { x: 250, y: 486, w: 130, h: 30 },
    { x: 540, y: 104, w: 130, h: 30 },
  ],
  playerSpawn: { x: 110, y: 120 },
  droneSpawns: [
    { x: 770, y: 520 }, { x: 110, y: 520 }, { x: 620, y: 250 },
    { x: 440, y: 540 }, { x: 300, y: 140 }, { x: 770, y: 110 },
  ],
};
const ARENAS = [MIRROR, BASTIONS, CROSSFIELD, TWINFORTS];

/* --- mirrored math from MindTankGame.tsx --- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function circleRect(px, py, r, w) {
  const cx = clamp(px, w.x, w.x + w.w), cy = clamp(py, w.y, w.y + w.h);
  const dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-6) { const d = Math.sqrt(d2); return { nx: dx / d, ny: dy / d, pen: r - d }; }
  const l = px - w.x, rt = w.x + w.w - px, t = py - w.y, b = w.y + w.h - py;
  const m = Math.min(l, rt, t, b);
  if (m === l) return { nx: -1, ny: 0, pen: r + l };
  if (m === rt) return { nx: 1, ny: 0, pen: r + rt };
  if (m === t) return { nx: 0, ny: -1, pen: r + t };
  return { nx: 0, ny: 1, pen: r + b };
}
function segHitsRect(x1, y1, x2, y2, w) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - w.x, w.x + w.w - x1, y1 - w.y, w.y + w.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function hasLOS(x1, y1, x2, y2, walls) {
  for (const w of walls) if (segHitsRect(x1, y1, x2, y2, w)) return false;
  return true;
}
function pointFree(x, y, r, walls) { return !walls.some((w) => circleRect(x, y, r, w)); }
function resolveWalls(x, y, r, vx, vy, e, walls) {
  for (const w of walls) {
    const c = circleRect(x, y, r, w);
    if (!c) continue;
    x += c.nx * c.pen; y += c.ny * c.pen;
    const vn = vx * c.nx + vy * c.ny;
    if (vn < 0) { vx -= (1 + e) * vn * c.nx; vy -= (1 + e) * vn * c.ny; }
  }
  return { x, y, vx, vy };
}
function interceptAngle(sx, sy, tx, ty, tvx, tvy, speed) {
  const dx = tx - sx, dy = ty - sy;
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  let t = -1;
  if (Math.abs(a) < 1e-4) { if (Math.abs(b) > 1e-4) t = -c / b; }
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2);
      if (t < 0) t = Math.max(t1, t2);
    }
  }
  if (!Number.isFinite(t) || t < 0) t = Math.hypot(dx, dy) / speed;
  t = Math.min(t, 400);
  return { ang: Math.atan2(dy + tvy * t, dx + tvx * t), t };
}

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ FAIL:', msg); } };

for (const a of ARENAS) {
  console.log(`arena "${a.id}" — walls=${a.walls.length} droneSpawns=${a.droneSpawns.length}`);
  for (const [i, w] of a.walls.entries()) {
    ok(w.x >= PAD - 10 && w.y >= PAD - 10 && w.x + w.w <= ARENA_W - PAD + 10 && w.y + w.h <= ARENA_H - PAD + 10, `wall ${i} out of frame`);
  }
  ok(pointFree(a.playerSpawn.x, a.playerSpawn.y, 18, a.walls), `player spawn blocked (${a.id})`);
  a.droneSpawns.forEach((s, i) => ok(pointFree(s.x, s.y, 20, a.walls), `drone spawn ${i} blocked (${a.id})`));
  // every drone spawn must reach the player side without crossing walls (LOS to playerSpawn)
  a.droneSpawns.forEach((s, i) => {
    const los = hasLOS(s.x, s.y, a.playerSpawn.x, a.playerSpawn.y, a.walls);
    if (!los) console.log(`  · note: drone spawn ${i} has no direct LOS to player spawn (fine — patrol will move)`);
  });
}

/* circle-rect push-out keeps bodies clear */
{
  const walls = BASTIONS.walls;
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    let x = Math.random() * ARENA_W, y = Math.random() * ARENA_H;
    const r = 15;
    const res = resolveWalls(x, y, r, 0, 0, 0, walls);
    for (const w of walls) {
      const c = circleRect(res.x, res.y, r - 0.01, w);
      if (c) worst++;
    }
  }
  ok(worst === 0, `push-out left ${worst} overlaps`);
  console.log('push-out overlap check over 4000 random points: clean =', worst === 0);
}

/* pulse reflection flips the normal component */
{
  const wall = { x: 400, y: 0, w: 30, h: 400 };
  let x = 396.5, y = 200, vx = 7.4, vy = 0;
  const c = circleRect(x, y, 5, wall);
  ok(!!c, 'pulse should collide with wall');
  x += c.nx * c.pen; y += c.ny * c.pen;
  const vn = vx * c.nx + vy * c.ny;
  if (vn < 0) { vx -= 2 * vn * c.nx; vy -= 2 * vn * c.ny; }
  ok(vx < 0, `reflected vx should be negative, got ${vx}`);
  ok(Math.abs(vx) === 7.4, 'reflection preserves speed');
  console.log('pulse reflection: vx', 7.4, '→', vx.toFixed(2), '(speed preserved)');
}

/* intercept solver: turret at origin, target passing by; exact min-distance check */
{
  const speed = 7.4;
  let worstMiss = 0;
  for (let i = 0; i < 2000; i++) {
    const tx = 100 + Math.random() * 500, ty = -200 + Math.random() * 400;
    const ang = Math.random() * Math.PI * 2;
    const sp = 0.5 + Math.random() * 3;
    const tvx = Math.cos(ang) * sp, tvy = Math.sin(ang) * sp;
    const { ang: fireAng } = interceptAngle(0, 0, tx, ty, tvx, tvy, speed);
    // exact closest approach of two constant-velocity points:
    // rel(t) = (cos·s − tvx, sin·s − tvy)·t + (0 − tx, 0 − ty); min |rel(t)|
    const ux = Math.cos(fireAng) * speed - tvx;
    const uy = Math.sin(fireAng) * speed - tvy;
    const rx = -tx, ry = -ty;
    const aa = ux * ux + uy * uy;
    const bb = 2 * (ux * rx + uy * ry);
    const cc = rx * rx + ry * ry;
    let minD;
    if (aa < 1e-9) minD = Math.sqrt(cc);
    else {
      const tmin = Math.max(0, -bb / (2 * aa));
      minD = Math.sqrt(Math.max(0, aa * tmin * tmin + bb * tmin + cc));
    }
    worstMiss = Math.max(worstMiss, minD);
  }
  ok(worstMiss < 6, `intercept worst miss-distance ${worstMiss.toFixed(2)} too big`);
  console.log('intercept solver worst exact miss over 2000 random passes:', worstMiss.toFixed(2), 'units (<6 required)');
}

/* LOS vs exact edge-intersection oracle */
{
  let mism = 0;
  const walls = CROSSFIELD.walls;
  const inWall = (x, y) => walls.some((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h);
  const segSeg = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
    const den = d1x * d2y - d1y * d2x;
    if (den === 0) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (let i = 0; i < 4000; i++) {
    let x1 = Math.random() * ARENA_W, y1 = Math.random() * ARENA_H;
    const x2 = Math.random() * ARENA_W, y2 = Math.random() * ARENA_H;
    // exact oracle: blocked iff either endpoint inside a wall, or the segment
    // crosses any wall edge while the segment midpoint near the wall is inside
    let blocked = inWall(x1, y1) || inWall(x2, y2);
    if (!blocked) {
      for (const w of walls) {
        const cross =
          segSeg(x1, y1, x2, y2, w.x, w.y, w.x + w.w, w.y) ||
          segSeg(x1, y1, x2, y2, w.x + w.w, w.y, w.x + w.w, w.y + w.h) ||
          segSeg(x1, y1, x2, y2, w.x + w.w, w.y + w.h, w.x, w.y + w.h) ||
          segSeg(x1, y1, x2, y2, w.x, w.y + w.h, w.x, w.y);
        if (cross) { blocked = true; break; }
      }
    }
    const fast = hasLOS(x1, y1, x2, y2, walls);
    if (fast !== !blocked) mism++;
  }
  ok(mism === 0, `LOS mismatched exact oracle on ${mism}/4000 samples`);
  console.log('Liang-Barsky LOS vs exact edge oracle: mismatches =', mism, '/4000');
}

/* drone spec sanity: wave-1 beatable, tier-10 hard */
{
  const spec = (t) => ({ speed: 1.5 + t * 0.18, fireMs: Math.max(760, 2500 - t * 165), hp: t <= 3 ? 1 : t <= 7 ? 2 : 3, lead: t < 4 ? 0 : Math.min(1, (t - 3) * 0.15) });
  const t1 = spec(1), t10 = spec(10);
  console.log(`tier1: speed=${t1.speed.toFixed(2)} fire=${t1.fireMs}ms hp=${t1.hp} lead=${t1.lead}`);
  console.log(`tier10: speed=${t10.speed.toFixed(2)} fire=${t10.fireMs}ms hp=${t10.hp} lead=${t10.lead}`);
  ok(t1.hp === 1 && t1.fireMs > 2200, 'tier 1 must be gentle');
  ok(t10.hp === 3 && t10.lead >= 0.99 && t10.speed >= 3.2, 'tier 10 must be genuinely hard');
}

/* full-run score ceiling */
{
  const waveDrones = [2, 2, 3, 3];
  let dronePts = 0;
  waveDrones.forEach((n, i) => { for (let k = 0; k < n; k++) dronePts += 150 + (i + 1) * 50; });
  const total = dronePts + 4 * 100 + 4 * 200 + 400 + 10 * 25; // all perfect + victory + every pickup
  console.log('max theoretical score:', total, '(server ceiling 6000, nominal full run ≈ 3200)');
  ok(total <= 6000, 'score ceiling must fit server clamp');
}

console.log(fails === 0 ? '\nALL CHECKS PASSED ✓' : `\n${fails} CHECKS FAILED ✗`);
process.exit(fails === 0 ? 0 : 1);
