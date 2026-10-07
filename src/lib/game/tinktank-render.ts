/**
 * tinktank-render — PROCEDURAL LAYERED VEHICLE RENDERER for "TINKTANK"
 * (task R12-c, the visual-upgrade headline feature).
 *
 * Pure canvas drawing, no side effects. Every fleet vehicle is composited
 * from parts whose geometry DEPENDS ON UPGRADE TIERS, so an upgraded vehicle
 * does not just gain numbers — it visibly grows:
 *
 *   armor tier  → bolted side-skirt panels → front wedge plate → reactive
 *                 armor bricks along the hull edges
 *   speed tier  → longer/wider treads (tanks), longer skids + bigger rotor
 *                 with 2→4 blades (helis), longer arms + prop guards
 *                 (drones), wider wingspan (jets)
 *   power tier  → longer, thicker barrel → muzzle brake at max tier;
 *                 bigger rocket pods / bomb bay / gun pods per class
 *   rate tier   → coax second barrel (tier≥2) and drum magazine (tier≥4);
 *                 chin-gun growth, wingtip missile rails on jets
 *   energy tier → glowing fuel cells → coil rings → pulsing capacitor dome
 *                 / longer afterburner nozzle(s)
 *
 * Procedural animations are TIME-DRIVEN (t = ms) with per-vehicle seeded
 * variation (mulberry32), so every vehicle feels alive but deterministic:
 * rotor spin + blur discs, tread scroll, recoil kick, muzzle flash, hover
 * bob, prop blur, afterburner shimmer, LED blink, idle turret sweep.
 *
 * Also hosts shared VFX helpers (hex-pattern energy shield, EMP pulse,
 * shockwave ring) plus the garage HANGAR PREVIEW and the before→after
 * UPGRADE DIAGRAM used on every garage stat row.
 */
import { clamp, mulberry32, vehicleClass, type TankSpec, type VehicleClass } from './tinktank-data';

/* ============================ tier helpers ============================ */

export interface UpgradeTiers { power: number; rate: number; speed: number; armor: number; energy: number }

/** Read the 0…5 upgrade tiers of a vehicle from the save's upgrade map. */
export function tiersOf(spec: TankSpec, upgrades: Record<string, number>): UpgradeTiers {
  const g = (stat: string): number => clamp(upgrades[`${spec.id}:${stat}`] ?? 0, 0, 5);
  return { power: g('power'), rate: g('rate'), speed: g('speed'), armor: g('armor'), energy: g('energy') };
}

const STEEL_DARK = '#1e293b';
const STEEL_MID = '#475569';
const STEEL_LIGHT = '#64748b';
const STEEL_EDGE = '#94a3b8';

function rr2(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ============================ main entry ============================== */

export interface VehicleDraw {
  ctx: CanvasRenderingContext2D;
  spec: TankSpec;
  cls?: VehicleClass;
  tiers: UpgradeTiers;
  x: number;
  y: number;
  hullAng: number;
  gunAng: number;
  time: number;        // ms clock driving procedural animation
  r: number;           // body radius reference (~14 in gameplay)
  moving: number;      // |velocity| in frame units (drives tread scroll etc.)
  muzzle: number;      // 0..1 muzzle-flash energy
  hpFrac: number;      // 1 = pristine, <0.4 adds soot + smoke stains
  bank?: number;       // heli roll −1…1 (lateral strafe feel)
  dashT?: number;      // jet dash remaining 0…1 (afterburner surge)
  lowFx?: boolean;
  silhouette?: boolean; // flat single-color silhouette (HUD mini-icon)
  alpha?: number;
  seed?: number;
}

/** Draw one layered, upgrade-aware vehicle. */
export function drawVehicle(o: VehicleDraw): void {
  const { ctx, spec, tiers } = o;
  const cls = o.cls ?? vehicleClass(spec);
  const r = o.r;
  const t = o.time;
  const rng = mulberry32(((o.seed ?? 1) * 7919 + 11) >>> 0);
  const ph = rng() * Math.PI * 2;        // procedural phase offset
  const variant = Math.floor(rng() * 3); // hull stripe variant

  /* grounded shadow (axis-aligned, drawn before everything) */
  const airGap = cls === 'drone' ? 7 : cls === 'heli' ? 5 : 3;
  ctx.save();
  ctx.translate(o.x, o.y + airGap);
  ctx.scale(1, 0.55);
  ctx.fillStyle = `rgba(0,0,0,${cls === 'drone' ? 0.18 : 0.3})`;
  ctx.beginPath();
  ctx.arc(0, 0, r * (cls === 'jet' ? 1.55 : cls === 'drone' ? 1.15 : 1.3), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const bob = cls === 'heli' ? Math.sin(t / 270 + ph) * 1.7 : cls === 'drone' ? Math.sin(t / 320 + ph) * 1.3 : 0;
  ctx.translate(o.x, o.y + bob);
  ctx.globalAlpha = o.alpha ?? 1;

  if (o.silhouette) {
    drawSilhouette(ctx, spec, cls, r, tiers);
    ctx.restore();
    return;
  }

  /* body pass (rotates with hull) */
  ctx.save();
  ctx.rotate(o.hullAng);
  if (cls === 'tank') drawTankBody(ctx, spec, tiers, r, t, o, ph, variant);
  else if (cls === 'heli') drawHeliBody(ctx, spec, tiers, r, t, o, ph);
  else if (cls === 'drone') drawDroneBody(ctx, spec, tiers, r, t, o, ph);
  else drawJetBody(ctx, spec, tiers, r, t, o, ph);
  ctx.restore();

  /* gun pass (rotates independently) */
  ctx.save();
  ctx.rotate(o.gunAng);
  drawGun(cls === 'tank' ? 'tank' : cls, ctx, spec, tiers, r, t, o, ph);
  ctx.restore();

  /* overhead class parts — rotor discs float above hull AND gun */
  if (cls === 'heli') drawMainRotor(ctx, spec, tiers, r, t, o, ph);
  if (cls === 'drone') drawPropDiscs(ctx, spec, tiers, r, t, o, ph);

  ctx.restore();
}

/* ============================ silhouette ============================== */

function drawSilhouette(ctx: CanvasRenderingContext2D, spec: TankSpec, cls: VehicleClass, r: number, tiers: UpgradeTiers): void {
  ctx.fillStyle = spec.glow;
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1.2;
  if (cls === 'tank') {
    rr2(ctx, -r * 1.05 - tiers.speed * 0.5, -r * 0.95, r * 2.1 + tiers.speed, r * 1.9, r * 0.35);
    ctx.fill();
    ctx.fillRect(0, -r * 0.22, r * 1.5 + tiers.power * 1.6, r * 0.44);
  } else if (cls === 'heli') {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.35, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-r * 2.1, -r * 0.14, r * 1.6, r * 0.28);
    ctx.beginPath();
    ctx.arc(0, -r * 0.2, r * 1.55 + tiers.speed * 1.1, 0, Math.PI * 2);
    ctx.stroke();
  } else if (cls === 'drone') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const rr3 = r * (i % 2 === 0 ? 0.85 : 0.62);
      const px = Math.cos(a) * rr3;
      const py = Math.sin(a) * rr3;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    const al = r * 1.1 + tiers.speed * 0.5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sx * al, sy * al);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx * al, sy * al, r * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(r * 1.55, 0);
    ctx.lineTo(-r * 0.9, r * 1.05 + tiers.speed * 0.6);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r * 0.9, -r * 1.05 - tiers.speed * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

/* ============================== TANK ================================== */

function drawTankBody(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers, r: number,
  t: number, o: VehicleDraw, ph: number, variant: number,
): void {
  const bank = o.bank ?? 0;
  ctx.scale(1 - Math.min(0.12, Math.abs(bank) * 0.1), 1);

  /* treads — speed tier widens/lengthens; scroll while moving */
  const treadLen = r * 2 + 3 + tiers.speed * 1.5;
  const treadW = r * 0.44 + tiers.speed * 0.16;
  const treadOff = r * 0.72;
  for (const side of [-1, 1]) {
    const ty = side * treadOff - treadW / 2;
    ctx.fillStyle = '#0f172a';
    rr2(ctx, -treadLen / 2 - 1, ty - 1, treadLen + 2, treadW + 2, treadW * 0.55);
    ctx.fill();
    ctx.fillStyle = STEEL_MID;
    rr2(ctx, -treadLen / 2, ty, treadLen, treadW, treadW * 0.5);
    ctx.fill();
    /* moving tread links (procedural scroll) */
    if (!o.lowFx) {
      const link = 6.2;
      const scroll = ((o.moving * t * 0.02) % link + link) % link;
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let lx = -treadLen / 2 + scroll; lx < treadLen / 2; lx += link) {
        ctx.moveTo(lx, ty + 1);
        ctx.lineTo(lx, ty + treadW - 1);
      }
      ctx.stroke();
    }
  }

  /* hull — base plate grows with armor tier */
  const hullW = r * 1.34 + tiers.armor * 0.55;
  const hullH = r * 1.3 + tiers.armor * 0.12;
  const hullG = ctx.createLinearGradient(-hullW / 2, -hullH / 2, hullW / 2, hullH / 2);
  hullG.addColorStop(0, STEEL_DARK);
  hullG.addColorStop(0.55, spec.color);
  hullG.addColorStop(1, spec.glow);
  rr2(ctx, -hullW / 2, -hullH / 2, hullW, hullH, r * 0.34);
  ctx.fillStyle = hullG;
  ctx.fill();
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  /* hull stripe variant (procedural identity) */
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = STEEL_DARK;
  if (variant === 0) ctx.fillRect(-hullW * 0.1, -hullH / 2 + 2, 2.4, hullH - 4);
  else if (variant === 1) ctx.fillRect(hullW * 0.16, -hullH / 2 + 2, 2.4, hullH - 4);
  else ctx.fillRect(-hullW / 2 + 3, -1.2, hullW - 6, 2.4);
  ctx.globalAlpha = 1;

  /* ARMOR T1 — bolted side skirts over the treads */
  if (tiers.armor >= 1) {
    for (const side of [-1, 1]) {
      const sy = side * (treadOff - 0.5) - (treadW + 2.6) / 2;
      rr2(ctx, -treadLen / 2 + 2, sy, treadLen - 4, treadW + 2.6, 2.5);
      ctx.fillStyle = STEEL_MID;
      ctx.fill();
      ctx.strokeStyle = STEEL_EDGE;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = STEEL_DARK;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-treadLen / 2 + 7 + i * ((treadLen - 14) / 2), side * treadOff, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  /* ARMOR T3 — front wedge + rear plate */
  if (tiers.armor >= 3) {
    ctx.fillStyle = STEEL_LIGHT;
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(hullW / 2 - 1, -hullH * 0.42);
    ctx.lineTo(hullW / 2 + 4.6, 0);
    ctx.lineTo(hullW / 2 - 1, hullH * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    rr2(ctx, -hullW / 2 - 3.4, -hullH * 0.34, 3.4, hullH * 0.68, 1.5);
    ctx.fill();
    ctx.stroke();
  }
  /* ARMOR T5 — reactive armor bricks */
  if (tiers.armor >= 5) {
    ctx.fillStyle = STEEL_DARK;
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        rr2(ctx, -hullW / 2 + 4 + i * (hullW - 10) / 4, side * (hullH / 2 - 3.4), (hullW - 10) / 4 - 1.4, 3, 0.8);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /* ENERGY — cells → coils → capacitor dome */
  drawEnergyCells(ctx, spec, tiers, -hullW * 0.28, 0, r, t, ph);

  /* battle soot when badly damaged */
  if (o.hpFrac < 0.4) drawSoot(ctx, r);
}

/* ============================ gun + turret ============================ */

function drawGun(
  cls: VehicleClass, ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers,
  r: number, t: number, o: VehicleDraw, ph: number,
): void {
  const recoil = o.muzzle > 0 ? o.muzzle : 0;
  const kick = recoil * 2.6;

  if (cls === 'tank') {
    /* turret ring */
    const turretR = r * 0.55 + tiers.power * 0.12;
    ctx.beginPath();
    ctx.arc(-kick * 0.4, 0, turretR, 0, Math.PI * 2);
    ctx.fillStyle = STEEL_DARK;
    ctx.fill();
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* main barrel — power tier: longer + thicker, muzzle brake at max */
    const bl = r * 0.85 + tiers.power * 2.3;
    const bw = r * 0.32 + tiers.power * 0.12;
    ctx.save();
    ctx.translate(-kick, 0);
    ctx.fillStyle = STEEL_MID;
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 0.8;
    rr2(ctx, turretR - 3, -bw / 2, bl, bw, bw * 0.45);
    ctx.fill();
    ctx.stroke();
    if (tiers.power >= 5) {
      /* muzzle brake fins */
      ctx.fillStyle = STEEL_DARK;
      ctx.fillRect(bl + turretR - 4, -bw / 2 - 1.4, 3, bw + 2.8);
      ctx.strokeRect(bl + turretR - 4, -bw / 2 - 1.4, 3, bw + 2.8);
    }
    /* RATE T2 — coax second barrel · RATE T4 — drum magazine */
    if (tiers.rate >= 2) {
      ctx.fillStyle = STEEL_LIGHT;
      rr2(ctx, turretR - 1, bw / 2 + 0.8, bl * 0.66, 2.4, 1.2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (tiers.rate >= 4) {
      ctx.fillStyle = STEEL_DARK;
      ctx.strokeStyle = spec.glow;
      ctx.lineWidth = 0.7;
      rr2(ctx, -turretR * 0.4, turretR * 0.35, turretR * 1.15, turretR * 0.62, 1.6);
      ctx.fill();
      ctx.stroke();
    }
    drawMuzzleFlash(ctx, turretR - kick + bl + (tiers.power >= 5 ? 0 : 0), 0, r, o.muzzle, spec.glow);
  } else if (cls === 'heli') {
    /* chin gun — rate tier lengthens it */
    const gl = r * 0.5 + tiers.rate * 0.16;
    ctx.fillStyle = STEEL_MID;
    rr2(ctx, r * 0.42 - kick * 0.5, -1.1, gl, 2.2, 1.1);
    ctx.fill();
    drawMuzzleFlash(ctx, r * 0.42 + gl, 0, r * 0.7, o.muzzle, spec.glow);
  } else if (cls === 'drone') {
    /* mini gun pod */
    const gl = r * 0.42 + tiers.rate * 0.13;
    ctx.fillStyle = STEEL_MID;
    rr2(ctx, r * 0.3 - kick * 0.4, -0.9, gl, 1.8, 0.9);
    ctx.fill();
    drawMuzzleFlash(ctx, r * 0.3 + gl, 0, r * 0.6, o.muzzle, spec.glow);
  }
  /* jets fire from nose gun — flash drawn in body pass */
  void ph;
}

function drawMuzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, muzzle: number, glow: string): void {
  if (muzzle <= 0) return;
  ctx.save();
  ctx.globalAlpha = clamp(muzzle, 0, 1);
  glowDot(ctx, x + 2, y, r * 0.8, '#fffbeb', clamp(muzzle, 0, 1) * 0.9);
  ctx.fillStyle = '#fffbeb';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.42);
  ctx.lineTo(x + r * 1.35 + Math.random() * 2, y);
  ctx.lineTo(x, y + r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ========================= shared energy parts ======================== */

/** ENERGY tier parts around an anchor point: cells → coils → dome. */
function drawEnergyCells(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers,
  ax: number, ay: number, r: number, t: number, ph: number,
): void {
  const pulse = 0.6 + 0.4 * Math.sin(t / 300 + ph);
  if (tiers.energy >= 1) {
    ctx.fillStyle = spec.glow;
    ctx.globalAlpha = 0.55 + 0.35 * pulse;
    ctx.fillRect(ax - 1.1, ay - r * 0.42, 2.2, r * 0.3);
    ctx.fillRect(ax - 1.1, ay + r * 0.12, 2.2, r * 0.3);
    ctx.globalAlpha = 1;
  }
  if (tiers.energy >= 3) {
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 1.1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ax + 4.5, ay + side * r * 0.4, 2.2, 0, Math.PI * 2 * pulse);
      ctx.stroke();
    }
  }
  if (tiers.energy >= 5) {
    glowDot(ctx, ax + 9, ay, 3.2, spec.glow, 0.5 + 0.4 * pulse);
    ctx.beginPath();
    ctx.arc(ax + 9, ay, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = spec.glow;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawSoot(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.fillStyle = 'rgba(2,6,23,0.5)';
  ctx.beginPath();
  ctx.arc(-r * 0.35, r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.arc(r * 0.2, -r * 0.35, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

/* ============================== HELI ================================== */

function drawHeliBody(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers, r: number,
  t: number, o: VehicleDraw, ph: number,
): void {
  const bank = o.bank ?? 0;
  ctx.scale(1 - Math.min(0.18, Math.abs(bank) * 0.16), 1);

  /* skids — speed tier lengthens them */
  const skidLen = r * 1.9 + tiers.speed * 1.1;
  const skidW = r * 0.2 + tiers.speed * 0.06;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-skidLen / 2, side * r * 0.78);
    ctx.lineTo(skidLen / 2, side * r * 0.78);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-skidLen * 0.3, side * r * 0.78);
    ctx.lineTo(-skidLen * 0.18, side * r * 0.42);
    ctx.moveTo(skidLen * 0.3, side * r * 0.78);
    ctx.lineTo(skidLen * 0.18, side * r * 0.42);
    ctx.stroke();
    void skidW;
  }

  /* tail boom + tail rotor */
  ctx.fillStyle = STEEL_MID;
  rr2(ctx, -r * 2.15, -r * 0.16, r * 1.7, r * 0.32, r * 0.14);
  ctx.fill();
  ctx.save();
  ctx.translate(-r * 2.05, 0);
  ctx.rotate(t * 0.05 + ph);
  ctx.strokeStyle = spec.glow;
  ctx.globalAlpha = o.lowFx ? 0.5 : 0.75;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.34, 0);
  ctx.lineTo(r * 0.34, 0);
  ctx.moveTo(0, -r * 0.34);
  ctx.lineTo(0, r * 0.34);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  /* fuselage */
  const fusG = ctx.createLinearGradient(-r, -r * 0.6, r, r * 0.6);
  fusG.addColorStop(0, STEEL_DARK);
  fusG.addColorStop(0.55, spec.color);
  fusG.addColorStop(1, spec.glow);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.28, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = fusG;
  ctx.fill();
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  /* cockpit */
  ctx.beginPath();
  ctx.ellipse(r * 0.62, 0, r * 0.34, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(226,232,240,0.85)';
  ctx.fill();

  /* stub wings + rocket pods (power tier) */
  const wingSpan = r * (1.15 + tiers.rate * 0.06);
  ctx.fillStyle = STEEL_MID;
  rr2(ctx, -r * 0.28, -wingSpan, r * 0.56, wingSpan * 2, 1.6);
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  const podLen = r * (0.42 + tiers.power * 0.14);
  for (const side of [-1, 1]) {
    const py = side * (wingSpan - r * 0.1);
    ctx.fillStyle = STEEL_DARK;
    ctx.strokeStyle = spec.glow;
    rr2(ctx, -podLen / 2, py - 2.6, podLen, 5.2, 2.4);
    ctx.fill();
    ctx.stroke();
    if (tiers.power >= 3) {
      ctx.fillStyle = STEEL_DARK;
      for (const dy of [-1.1, 1.1]) {
        ctx.beginPath();
        ctx.arc(podLen / 2 - 1.6, py + dy, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    /* pod muzzle flash on fire */
    if (o.muzzle > 0) drawMuzzleFlash(ctx, podLen / 2 + 1, py, r * 0.5, o.muzzle, spec.glow);
  }
  /* RATE T4 — drum magazine under belly */
  if (tiers.rate >= 4) {
    ctx.fillStyle = STEEL_DARK;
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(-r * 0.5, 0, r * 0.3, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /* armor shrouds */
  if (tiers.armor >= 1) {
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.28, -1.1, 1.1);
    ctx.stroke();
  }
  if (tiers.armor >= 3) {
    ctx.fillStyle = STEEL_MID;
    rr2(ctx, -r * 0.9, -r * 0.74, r * 1.5, r * 1.48, 3);
    ctx.globalAlpha = 0.32;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  if (tiers.armor >= 5) {
    ctx.fillStyle = STEEL_DARK;
    for (let i = 0; i < 3; i++) {
      rr2(ctx, -r * 0.7 + i * r * 0.5, -r * 0.62, r * 0.34, r * 0.28, 1);
      ctx.fill();
      rr2(ctx, -r * 0.7 + i * r * 0.5, r * 0.34, r * 0.34, r * 0.28, 1);
      ctx.fill();
    }
  }

  drawEnergyCells(ctx, spec, tiers, -r * 0.95, 0, r, t, ph);
  if (o.hpFrac < 0.4) drawSoot(ctx, r);
}

/** Main rotor — 2 blades, 4 blades from speed tier 2; blur disc. */
function drawMainRotor(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers,
  r: number, t: number, o: VehicleDraw, ph: number,
): void {
  const bladeLen = r * 1.7 + tiers.speed * 1.35;
  const blades = tiers.speed >= 2 ? 4 : 2;
  const ang = t * (o.lowFx ? 0.012 : 0.026) + ph;
  ctx.save();
  /* mast */
  ctx.fillStyle = STEEL_DARK;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!o.lowFx) {
    /* blur disc */
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = spec.glow;
    ctx.beginPath();
    ctx.arc(0, 0, bladeLen, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, bladeLen * 0.97, ang, ang + 2.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, bladeLen * 0.97, ang + Math.PI, ang + Math.PI + 2.2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(226,232,240,0.85)';
  for (let i = 0; i < blades; i++) {
    ctx.rotate((Math.PI * 2) / blades);
    rr2(ctx, r * 0.2, -0.9, bladeLen - r * 0.2, 1.8, 0.9);
    ctx.fill();
  }
  ctx.restore();
}

/* ============================== DRONE ================================= */

function drawDroneBody(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers, r: number,
  t: number, o: VehicleDraw, ph: number,
): void {
  void ph;
  const armLen = r * 0.95 + tiers.speed * 0.5;

  /* arms + motor pods (guards appear at armor tier≥2) */
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ex = sx * armLen;
    const ey = sy * armLen;
    ctx.strokeStyle = STEEL_MID;
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    /* pod */
    ctx.fillStyle = STEEL_DARK;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.17 + tiers.speed * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (tiers.armor >= 2) {
      /* prop guard ring */
      ctx.strokeStyle = STEEL_EDGE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.46 + tiers.speed * 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    /* ENERGY — blinking LED per arm */
    if (tiers.energy >= 1 && (Math.floor(t / 260 + sx * 1.7 + sy) % 2 === 0)) {
      ctx.fillStyle = spec.glow;
      ctx.beginPath();
      ctx.arc(ex * 0.6, ey * 0.6, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tiers.energy >= 5) glowDot(ctx, ex * 0.6, ey * 0.6, 1.4, spec.glow, 0.5);
  }

  /* hull octagon */
  const hullG = ctx.createLinearGradient(-r, -r, r, r);
  hullG.addColorStop(0, STEEL_DARK);
  hullG.addColorStop(0.6, spec.color);
  hullG.addColorStop(1, spec.glow);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    const rr3 = r * (i % 2 === 0 ? 0.85 : 0.7) + tiers.armor * 0.05;
    const px = Math.cos(a) * rr3;
    const py = Math.sin(a) * rr3;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = hullG;
  ctx.fill();
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  /* armor ring segments */
  if (tiers.armor >= 1) {
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = tiers.armor >= 5 ? 2.4 : 1.6;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, (Math.PI / 2) * i + 0.28, (Math.PI / 2) * (i + 1) - 0.28);
      ctx.stroke();
    }
  }
  if (tiers.armor >= 3) {
    /* mesh dome */
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(i * r * 0.3, -r * 0.6);
      ctx.lineTo(i * r * 0.3, r * 0.6);
    }
    ctx.stroke();
  }

  /* camera dome (front) */
  ctx.beginPath();
  ctx.arc(r * 0.42, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = spec.glow;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = 0.8;
  ctx.stroke();

  /* bomb bay — grows with power tier */
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2 + tiers.power * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = STEEL_DARK;
  ctx.fill();
  ctx.strokeStyle = STEEL_MID;
  ctx.lineWidth = 0.8;
  ctx.stroke();

  drawEnergyCells(ctx, spec, tiers, -r * 0.45, 0, r * 0.8, t, t / 500);
  if (o.hpFrac < 0.4) drawSoot(ctx, r);
}

/** Spinning prop blur discs at the four motor pods (drawn above the hull). */
function drawPropDiscs(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers,
  r: number, t: number, o: VehicleDraw, ph: number,
): void {
  const armLen = r * 0.95 + tiers.speed * 0.5;
  const discR = r * 0.42 + tiers.speed * 0.09;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const ex = sx * armLen;
    const ey = sy * armLen;
    ctx.save();
    ctx.translate(ex, ey);
    if (!o.lowFx) {
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = spec.glow;
      ctx.beginPath();
      ctx.arc(0, 0, discR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = spec.glow;
      ctx.lineWidth = 1;
      const a = t * 0.05 + ph + sx * sy;
      ctx.beginPath();
      ctx.arc(0, 0, discR * 0.85, a, a + 1.8);
      ctx.stroke();
    }
    ctx.globalAlpha = o.lowFx ? 0.5 : 0.8;
    ctx.strokeStyle = 'rgba(226,232,240,0.8)';
    ctx.lineWidth = 1;
    ctx.rotate(t * (o.lowFx ? 0.02 : 0.055) + ph + sx * sy * 2);
    for (let i = 0; i < 2; i++) {
      ctx.rotate(Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(discR * 0.8, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* =============================== JET ================================== */

function drawJetBody(
  ctx: CanvasRenderingContext2D, spec: TankSpec, tiers: UpgradeTiers, r: number,
  t: number, o: VehicleDraw, ph: number,
): void {
  const dash = clamp(o.dashT ?? 0, 0, 1);
  const span = 1 + tiers.speed * 0.035;

  /* afterburner (behind the airframe) */
  const nozzles = 1 + (tiers.energy >= 3 ? 1 : 0);
  const flicker = o.lowFx ? 0.85 : 0.8 + 0.35 * Math.sin(t / 34 + ph) * Math.random();
  const flameLen = r * (0.5 + tiers.energy * 0.13) * (dash > 0 ? 2.3 : 1) * flicker;
  for (let n = 0; n < nozzles; n++) {
    const ny = nozzles === 1 ? 0 : (n === 0 ? -r * 0.24 : r * 0.24);
    const g = ctx.createLinearGradient(-r * 0.9, ny, -r * 0.9 - flameLen, ny);
    g.addColorStop(0, 'rgba(255,251,235,0.95)');
    g.addColorStop(0.35, spec.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, ny - r * 0.16);
    ctx.quadraticCurveTo(-r * 0.9 - flameLen * 0.6, ny - r * 0.1, -r * 0.9 - flameLen, ny);
    ctx.quadraticCurveTo(-r * 0.9 - flameLen * 0.6, ny + r * 0.1, -r * 0.85, ny + r * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  if (dash > 0) {
    /* speed streaks during the strafing run */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const ly = (i - 1) * r * 0.5;
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, ly);
      ctx.lineTo(-r * (2.4 + dash * 2), ly);
      ctx.stroke();
    }
  }

  /* delta wing airframe */
  const pts: [number, number][] = [
    [r * 1.55, 0],
    [r * 0.55, r * 0.35],
    [r * 0.15 * span, r * 1.08 * span],
    [-r * 0.62, r * 0.98 * span],
    [-r * 0.4, r * 0.3],
    [-r * 0.95, r * 0.42],
    [-r * 0.95, -r * 0.42],
    [-r * 0.4, -r * 0.3],
    [-r * 0.62, -r * 0.98 * span],
    [r * 0.15 * span, -r * 1.08 * span],
    [r * 0.55, -r * 0.35],
  ];
  const bodyG = ctx.createLinearGradient(-r, 0, r * 1.5, 0);
  bodyG.addColorStop(0, STEEL_DARK);
  bodyG.addColorStop(0.55, spec.color);
  bodyG.addColorStop(1, spec.glow);
  ctx.beginPath();
  pts.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.closePath();
  ctx.fillStyle = bodyG;
  ctx.fill();
  ctx.strokeStyle = spec.glow;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  /* twin tail fins */
  ctx.fillStyle = STEEL_MID;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, side * r * 0.3);
    ctx.lineTo(-r * 1.05, side * r * 0.62);
    ctx.lineTo(-r * 1.0, side * r * 0.28);
    ctx.closePath();
    ctx.fill();
  }

  /* canopy */
  ctx.beginPath();
  ctx.ellipse(r * 0.5, 0, r * 0.3, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(226,232,240,0.9)';
  ctx.fill();

  /* nose gun (power tier) */
  if (tiers.power >= 1) {
    ctx.fillStyle = STEEL_MID;
    rr2(ctx, r * 0.9, -1, r * (0.4 + tiers.power * 0.1), 2, 1);
    ctx.fill();
    if (o.muzzle > 0) drawMuzzleFlash(ctx, r * (1.3 + tiers.power * 0.1), 0, r * 0.6, o.muzzle, spec.glow);
  }

  /* armor — leading-edge plates */
  if (tiers.armor >= 1) {
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(r * 0.6, r * 0.38);
    ctx.lineTo(r * 0.16 * span, r * 1.05 * span);
    ctx.moveTo(r * 0.6, -r * 0.38);
    ctx.lineTo(r * 0.16 * span, -r * 1.05 * span);
    ctx.stroke();
  }
  if (tiers.armor >= 3) {
    ctx.fillStyle = STEEL_MID;
    ctx.globalAlpha = 0.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.5, side * r * 0.3);
      ctx.lineTo(-r * 0.5, side * r * 0.9 * span);
      ctx.lineTo(-r * 0.55, side * r * 0.35);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (tiers.armor >= 5) {
    ctx.fillStyle = STEEL_DARK;
    ctx.strokeStyle = spec.glow;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      rr2(ctx, r * 0.1 - i * r * 0.42, -r * 0.1, r * 0.3, r * 0.2, 0.6);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* RATE T2/T4 — wingtip missile rails */
  if (tiers.rate >= 2) {
    ctx.fillStyle = STEEL_DARK;
    for (const side of [-1, 1]) {
      const my = side * r * 1.02 * span;
      rr2(ctx, -r * 0.5, my - 1.2, r * 0.7, 2.4, 1.2);
      ctx.fill();
      ctx.fillStyle = spec.glow;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, my - 1.2);
      ctx.lineTo(r * 0.32, my);
      ctx.lineTo(r * 0.2, my + 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = STEEL_DARK;
    }
  }
  if (tiers.rate >= 4) {
    ctx.fillStyle = STEEL_DARK;
    for (const side of [-1, 1]) {
      const my = side * r * 0.68 * span;
      rr2(ctx, -r * 0.35, my - 1, r * 0.55, 2, 1);
      ctx.fill();
    }
  }

  drawEnergyCells(ctx, spec, tiers, -r * 0.1, 0, r * 0.8, t, ph);
  if (o.hpFrac < 0.4) drawSoot(ctx, r);
}

/* ============================= VFX helpers ============================ */

/** Hex-lattice energy shield (pickup/overshield). */
export function drawHexShield(
  ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, t: number,
  color = '#38bdf8', hits = 0,
): void {
  const pulse = 0.5 + 0.3 * Math.sin(t / 140);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35 + pulse * 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  /* hex cells around the rim */
  const cells = 12;
  ctx.lineWidth = 1;
  for (let i = 0; i < cells; i++) {
    const a = (Math.PI * 2 * i) / cells + t / 1600;
    const hx = Math.cos(a) * radius;
    const hy = Math.sin(a) * radius;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ha = (Math.PI / 3) * k + a;
      const px = hx + Math.cos(ha) * radius * 0.16;
      const py = hy + Math.sin(ha) * radius * 0.16;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
  if (hits > 0) {
    ctx.fillStyle = color;
    for (let i = 0; i < hits; i++) {
      ctx.beginPath();
      ctx.arc(-4 + i * 8, -radius - 6, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Expanding shockwave ring + white flash (explosions). */
export function drawShockwave(
  ctx: CanvasRenderingContext2D, x: number, y: number, p: number, maxR: number, color = '#fbbf24',
): void {
  const ease = 1 - Math.pow(1 - clamp(p, 0, 1), 2.2);
  const rad = 6 + maxR * ease;
  ctx.save();
  /* flash */
  if (p < 0.3) {
    const fa = (1 - p / 0.3) * 0.85;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 0.9);
    g.addColorStop(0, `rgba(255,255,255,${fa})`);
    g.addColorStop(0.5, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  /* ring */
  ctx.globalAlpha = (1 - p) * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2 * (1 - p) + 0.6;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.globalAlpha = (1 - p) * 0.6;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** EMP pulse — expanding double dashed circle. */
export function drawEmpPulse(
  ctx: CanvasRenderingContext2D, x: number, y: number, p: number, maxR: number, color = '#7dd3fc',
): void {
  const ease = 1 - Math.pow(1 - clamp(p, 0, 1), 2);
  const rad = 14 + maxR * ease;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -p * 40;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* =========================== garage previews ========================== */

/** HANGAR PREVIEW — animated vehicle on a lit hangar pad (garage cards). */
export function drawHangarPreview(
  ctx: CanvasRenderingContext2D, spec: TankSpec, cls: VehicleClass, tiers: UpgradeTiers,
  w: number, h: number, t: number, selected: boolean,
): void {
  /* hangar backdrop */
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0d1424');
  bg.addColorStop(1, '#070b14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  /* floor grid */
  ctx.strokeStyle = 'rgba(148,163,184,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gy = Math.round(h * 0.62); gy < h; gy += 7) {
    ctx.moveTo(4, gy);
    ctx.lineTo(w - 4, gy);
  }
  ctx.stroke();
  for (let gx = 8; gx < w; gx += 14) {
    ctx.beginPath();
    ctx.moveTo(gx, h * 0.62);
    ctx.lineTo(gx + (gx - w / 2) * 0.22, h);
    ctx.stroke();
  }

  /* spotlight cone */
  const sp = ctx.createRadialGradient(w / 2, h * 0.42, 4, w / 2, h * 0.42, h * 0.85);
  sp.addColorStop(0, `${spec.glow}22`);
  sp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sp;
  ctx.fillRect(0, 0, w, h);

  /* selected scan ring */
  if (selected) {
    ctx.save();
    ctx.translate(w / 2, h * 0.48);
    ctx.rotate(t / 1400);
    ctx.strokeStyle = `${spec.glow}88`;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* pad ellipse */
  ctx.save();
  ctx.translate(w / 2, h * 0.74);
  ctx.scale(1, 0.32);
  ctx.strokeStyle = `${spec.color}55`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, h * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  /* the vehicle — idle animation, 1.5× card scale */
  const r = Math.min(w, h) * 0.2;
  drawVehicle({
    ctx, spec, cls, tiers,
    x: w / 2, y: h * 0.48,
    hullAng: -Math.PI / 2 + Math.sin(t / 1700) * 0.1,
    gunAng: -Math.PI / 2 + Math.sin(t / 2300) * 0.5,
    time: t, r, moving: 0, muzzle: 0, hpFrac: 1,
    seed: spec.id.length * 17 + spec.id.charCodeAt(0),
  });
}

/**
 * UPGRADE DIAGRAM — before→after micro-comparison of one stat tier.
 * Draws the same vehicle twice (mini scale): left = current tier (dim),
 * right = next tier on `stat` (bright), with an arrow between.
 */
export function drawUpgradeDiagram(
  ctx: CanvasRenderingContext2D, spec: TankSpec, cls: VehicleClass,
  from: UpgradeTiers, to: UpgradeTiers, w: number, h: number, t: number,
): void {
  const r = h * 0.34;
  ctx.clearRect(0, 0, w, h);

  /* before (dim) */
  drawVehicle({
    ctx, spec, cls, tiers: from,
    x: w * 0.26, y: h * 0.52, hullAng: -Math.PI / 2, gunAng: -Math.PI / 2,
    time: t, r, moving: 0, muzzle: 0, hpFrac: 1, alpha: 0.42,
    seed: spec.id.length * 17 + spec.id.charCodeAt(0),
  });
  /* after (bright) */
  drawVehicle({
    ctx, spec, cls, tiers: to,
    x: w * 0.74, y: h * 0.52, hullAng: -Math.PI / 2, gunAng: -Math.PI / 2,
    time: t, r, moving: 0, muzzle: 0, hpFrac: 1,
    seed: spec.id.length * 17 + spec.id.charCodeAt(0),
  });

  /* arrow */
  ctx.strokeStyle = 'rgba(251,191,36,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(w * 0.42, h * 0.52);
  ctx.lineTo(w * 0.58, h * 0.52);
  ctx.moveTo(w * 0.58 - 4, h * 0.52 - 3);
  ctx.lineTo(w * 0.58, h * 0.52);
  ctx.lineTo(w * 0.58 - 4, h * 0.52 + 3);
  ctx.stroke();
}
