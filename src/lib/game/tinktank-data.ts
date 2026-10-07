/**
 * tinktank-data — pure data + deterministic generation for "TINKTANK" (تینک‌تانک),
 * the 40-level tank-progression campaign (task A1).
 *
 * Everything here is framework-free and side-effect free except the explicit
 * save/load helpers (localStorage `doi_tinktank_v1`).
 *
 * CAMPAIGN MATH
 *  - Level L (1-based) contains  4 + ((L * 7) % 16)  missions  → 4…19 missions.
 *  - Mission objective rotates by missionIndex % 3 → CLEAR / SURVIVE / SIEGE.
 *  - Every 4th level's final mission is a BOSS (level % 4 === 0).
 *  - All layouts are seeded by  seed = level * 1000 + missionIndex  (mulberry32),
 *    so every mission is deterministic and reproducible across devices/sessions.
 *
 * BALANCE CONTRACT
 *  The free starter tank ("Rustbucket MK-I") can finish all 40 levels — enemy
 *  pressure comes from numbers, fire patterns and aim, never from stat walls.
 *  Enemy HP stays low (1–4), drone speed is always below the player's, and
 *  every drone has a visible aim telegraph.
 */
import type { Locale } from '@/lib/i18n';

/* ============================== seeded RNG ============================== */

/** mulberry32 — tiny, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ================================ world ================================ */

export const WORLD_W = 1120;
export const WORLD_H = 780;
export const PAD = 30; // playable inset from world border

export interface TTWall { x: number; y: number; w: number; h: number }

/* ================================ tanks ================================ */

export type TTStat = 'power' | 'rate' | 'speed' | 'armor' | 'energy';
export const TT_STATS: TTStat[] = ['power', 'rate', 'speed', 'armor', 'energy'];
export type TTSpecial =
  | 'overdrive' | 'frenzy' | 'shockwave' | 'emp' | 'nova' | 'beam' | 'blink' | 'overshield'
  /* R12-c class specials */
  | 'rocketsalvo'   // helis — salvo of splash rockets
  | 'recondar'      // recon drone — radar pulse marks/reveals every target
  | 'carpet'        // bomber UAV — row of delay-fuse bombs
  | 'strafingrun';  // jets — boost dash across the arena with bullet rain

/**
 * Vehicle classes (R12-c fleet expansion). The original 8 tanks keep the
 * implicit 'tank' class (spec.cls is optional for save/roster backward
 * compatibility) — always read the class through vehicleClass().
 */
export type VehicleClass = 'tank' | 'heli' | 'drone' | 'jet';

export interface TankSpec {
  id: string;
  nameFa: string;
  nameEn: string;
  price: number;          // 0 = free starter
  reqLevel: number;       // driver level gate
  color: string;          // hull base
  glow: string;           // neon accent
  barrel: 'std' | 'twin' | 'heavy' | 'coil' | 'mortar' | 'beam' | 'phase' | 'prime';
  base: Record<TTStat, number>;  // 1…10
  cap: Record<TTStat, number>;   // max after 5 upgrade tiers
  special: TTSpecial;
  blurbFa: string;
  blurbEn: string;
  cls?: VehicleClass;     // omitted → 'tank' (legacy 8)
  passive?: 'chain' | 'splash' | 'pierce' | 'regen' | 'none' | 'hrockets' | 'hbomb' | 'hdash';
}

/** Class of any fleet vehicle — legacy tanks default to 'tank'. */
export function vehicleClass(v: TankSpec): VehicleClass {
  return v.cls ?? 'tank';
}

/** i18n key suffix for the vehicle's passive trait (tt_passive_*). */
export function passiveKey(v: TankSpec): string {
  return v.passive ?? 'none';
}

export const TANKS: TankSpec[] = [
  {
    id: 'rustbucket', nameFa: 'زنگ‌وله مارک-۱', nameEn: 'Rustbucket MK-I',
    price: 0, reqLevel: 1, color: '#f59e0b', glow: '#fbbf24', barrel: 'std',
    base: { power: 3, rate: 3, speed: 4, armor: 3, energy: 2 },
    cap: { power: 6, rate: 6, speed: 7, armor: 6, energy: 5 },
    special: 'overdrive',
    blurbFa: 'تانک آموزشی کارگاه — ساده، سرسخت و همیشه قابل تعمیر.',
    blurbEn: 'The workshop trainer — simple, stubborn, always repairable.',
  },
  {
    id: 'scorpion', nameFa: 'کژدم', nameEn: 'Scorpion',
    price: 800, reqLevel: 3, color: '#a3e635', glow: '#bef264', barrel: 'twin',
    base: { power: 3, rate: 7, speed: 8, armor: 2, energy: 4 },
    cap: { power: 6, rate: 10, speed: 10, armor: 4, energy: 7 },
    special: 'frenzy',
    blurbFa: 'سریع و زنبورگونه؛ زره کم اما شلیکی بی‌امان.',
    blurbEn: 'Fast and wasp-like; thin armor, relentless fire.',
  },
  {
    id: 'bastion', nameFa: 'استحکام', nameEn: 'Bastion',
    price: 1500, reqLevel: 5, color: '#94a3b8', glow: '#cbd5e1', barrel: 'heavy',
    base: { power: 7, rate: 3, speed: 3, armor: 8, energy: 3 },
    cap: { power: 10, rate: 5, speed: 5, armor: 10, energy: 6 },
    special: 'shockwave',
    blurbFa: 'دژ متحرک — هر گلوله‌اش زمین را می‌لرزاند.',
    blurbEn: 'A moving fortress — every shell shakes the ground.',
  },
  {
    id: 'tesla', nameFa: 'تسلا', nameEn: 'Tesla Coil',
    price: 2600, reqLevel: 8, color: '#38bdf8', glow: '#7dd3fc', barrel: 'coil',
    base: { power: 4, rate: 5, speed: 5, armor: 4, energy: 7 },
    cap: { power: 7, rate: 8, speed: 8, armor: 7, energy: 10 },
    special: 'emp',
    passive: 'chain',
    blurbFa: 'قوس‌های الکتریکی شلیکش به هدف کناری هم جهش می‌کند.',
    blurbEn: 'Its arcs jump to one nearby enemy — chain lightning.',
  },
  {
    id: 'volcano', nameFa: 'آتشفشان', nameEn: 'Volcano',
    price: 3800, reqLevel: 11, color: '#f97316', glow: '#fdba74', barrel: 'mortar',
    base: { power: 8, rate: 3, speed: 4, armor: 5, energy: 4 },
    cap: { power: 10, rate: 6, speed: 6, armor: 8, energy: 7 },
    special: 'nova',
    passive: 'splash',
    blurbFa: 'گدازه‌پاش دفاع شرق — هر برخورد، ترکش گداخته می‌پاشد.',
    blurbEn: 'Molten shells splash lava on impact.',
  },
  {
    id: 'prism', nameFa: 'منشور', nameEn: 'Prism',
    price: 5200, reqLevel: 15, color: '#e879f9', glow: '#f0abfc', barrel: 'beam',
    base: { power: 5, rate: 4, speed: 6, armor: 4, energy: 7 },
    cap: { power: 8, rate: 7, speed: 9, armor: 7, energy: 10 },
    special: 'beam',
    passive: 'pierce',
    blurbFa: 'پرتوهایش از میان همهٔ اهداف پیوسته می‌گذرد.',
    blurbEn: 'Its beams pierce straight through every target.',
  },
  {
    id: 'mirage', nameFa: 'سراب', nameEn: 'Mirage',
    price: 7000, reqLevel: 19, color: '#22d3ee', glow: '#a5f3fc', barrel: 'phase',
    base: { power: 5, rate: 5, speed: 7, armor: 4, energy: 7 },
    cap: { power: 8, rate: 8, speed: 10, armor: 7, energy: 10 },
    special: 'blink',
    blurbFa: 'در یک چشم‌به‌هم‌زدن جا خالی می‌کند — سرابی از فولاد.',
    blurbEn: 'Blinks out of danger in the blink of an eye.',
  },
  {
    id: 'omega', nameFa: 'امگا پرایم', nameEn: 'Omega Prime',
    price: 12000, reqLevel: 25, color: '#fbbf24', glow: '#fef3c7', barrel: 'prime',
    base: { power: 8, rate: 7, speed: 7, armor: 7, energy: 8 },
    cap: { power: 10, rate: 10, speed: 10, armor: 10, energy: 10 },
    special: 'overshield',
    passive: 'regen',
    blurbFa: 'افسانهٔ کارگاه — همه‌چیزِ بهترین، به‌همراه سپر خودترمیم.',
    blurbEn: 'Workshop legend — best of everything, self-regenerating shield.',
  },
];

/* ── R12-c fleet expansion — HELICOPTERS ────────────────────────────────
 * Hover over ground obstacles (cross walls slowly instead of colliding),
 * strafing lateral movement, spinning rotors, rocket pods with slight
 * splash on the salvo. Fragile armor, high rate of fire.
 * ────────────────────────────────────────────────────────────────────── */
export const HELICOPTERS: TankSpec[] = [
  {
    id: 'scout_hawk', nameFa: 'شاهین آشکار', nameEn: 'Scout Hawk',
    price: 800, reqLevel: 8, color: '#4ade80', glow: '#bbf7d0', barrel: 'twin',
    base: { power: 3, rate: 6, speed: 5, armor: 2, energy: 4 },
    cap: { power: 6, rate: 10, speed: 9, armor: 5, energy: 8 },
    special: 'rocketsalvo', passive: 'hrockets', cls: 'heli',
    blurbFa: 'هلی‌کوپتر شناسایی سبک — بر فراز موانع معلق می‌زند و با راکت‌های سریع نیش می‌کارد.',
    blurbEn: 'Light scout helicopter — hovers over obstacles, stings with rapid rockets.',
  },
  {
    id: 'gunship_raven', nameFa: 'کلاغ توپدار', nameEn: 'Gunship Raven',
    price: 4800, reqLevel: 14, color: '#fb7185', glow: '#fecdd3', barrel: 'heavy',
    base: { power: 5, rate: 5, speed: 4, armor: 3, energy: 5 },
    cap: { power: 9, rate: 9, speed: 7, armor: 6, energy: 9 },
    special: 'rocketsalvo', passive: 'hrockets', cls: 'heli',
    blurbFa: 'توپخانهٔ پرنده — راکت‌پدهای سنگین و آتش پشتیبان بی‌وقفه.',
    blurbEn: 'Flying artillery — heavy rocket pods and endless covering fire.',
  },
  {
    id: 'storm_lance', nameFa: 'نیزهٔ توفان', nameEn: 'Storm Lance',
    price: 8500, reqLevel: 20, color: '#a78bfa', glow: '#ddd6fe', barrel: 'coil',
    base: { power: 6, rate: 7, speed: 5, armor: 3, energy: 7 },
    cap: { power: 9, rate: 10, speed: 8, armor: 6, energy: 10 },
    special: 'emp', passive: 'hrockets', cls: 'heli',
    blurbFa: 'توفان الکتریکی آسمان — پالس الکترومغناطیسی‌اش دشمنان را فلج می‌کند.',
    blurbEn: "The sky's electric storm — its EMP pulse paralyses whole squads.",
  },
];

/* ── R12-c fleet expansion — DRONES ─────────────────────────────────────
 * The ONLY class that flies clean over walls. Very fast, very fragile,
 * delay-fuse bomb drops on arcing trajectories. raven_eye's recon radar
 * reveals mission targets; thunder_uav carpets an area in bombs.
 * ────────────────────────────────────────────────────────────────────── */
export const DRONES: TankSpec[] = [
  {
    id: 'wasp', nameFa: 'زنبور', nameEn: 'Wasp',
    price: 2400, reqLevel: 10, color: '#fde047', glow: '#fef08a', barrel: 'std',
    base: { power: 2, rate: 7, speed: 8, armor: 1, energy: 4 },
    cap: { power: 5, rate: 10, speed: 10, armor: 3, energy: 8 },
    special: 'blink', passive: 'hbomb', cls: 'drone',
    blurbFa: 'زنبورِ آسمان — از روی دیوارها پرواز می‌کند و در یک پلک ناپدید می‌شود.',
    blurbEn: 'A wasp of the skies — flies clean over walls and blinks out of danger.',
  },
  {
    id: 'raven_eye', nameFa: 'چشم کلاغ', nameEn: 'Raven Eye',
    price: 3900, reqLevel: 13, color: '#2dd4bf', glow: '#99f6e4', barrel: 'std',
    base: { power: 2, rate: 5, speed: 7, armor: 2, energy: 7 },
    cap: { power: 5, rate: 8, speed: 10, armor: 5, energy: 10 },
    special: 'recondar', passive: 'hbomb', cls: 'drone',
    blurbFa: 'پهپاد شناسایی — رادارش همهٔ اهداف مأموریت را حتی پشت دیوار آشکار می‌کند.',
    blurbEn: 'Recon drone — its radar reveals every mission target, even behind walls.',
  },
  {
    id: 'thunder_uav', nameFa: 'آذرخش', nameEn: 'Thunder UAV',
    price: 6800, reqLevel: 18, color: '#fb923c', glow: '#fed7aa', barrel: 'mortar',
    base: { power: 4, rate: 5, speed: 7, armor: 2, energy: 6 },
    cap: { power: 7, rate: 8, speed: 10, armor: 4, energy: 9 },
    special: 'carpet', passive: 'hbomb', cls: 'drone',
    blurbFa: 'بمب‌افکن بی‌سرنشین — ردیف بمب‌های کازنی با فیوز تأخیری فرود می‌آورد.',
    blurbEn: 'Unmanned bomber — lays rows of delay-fuse bombs across the arena.',
  },
];

/* ── R12-c fleet expansion — AIRCRAFT ──────────────────────────────────
 * Jet strafing runs: one long-cooldown boost dash across the arena with
 * bullet rain (piercing streaks), then an energy loop while it recharges.
 * ────────────────────────────────────────────────────────────────────── */
export const AIRCRAFT: TankSpec[] = [
  {
    id: 'stratos', nameFa: 'استراتوس', nameEn: 'Stratos',
    price: 5500, reqLevel: 16, color: '#e2e8f0', glow: '#f8fafc', barrel: 'phase',
    base: { power: 4, rate: 6, speed: 8, armor: 2, energy: 5 },
    cap: { power: 8, rate: 9, speed: 10, armor: 4, energy: 9 },
    special: 'strafingrun', passive: 'hdash', cls: 'jet',
    blurbFa: 'جنگندهٔ استراتوسفر — با یک رانش، باران گلوله بر میدان می‌بارد.',
    blurbEn: 'Stratosphere jet — one boost dash, a rain of bullets across the field.',
  },
  {
    id: 'nova_wing', nameFa: 'بال نووا', nameEn: 'Nova Wing',
    price: 12000, reqLevel: 24, color: '#fbbf24', glow: '#fef3c7', barrel: 'prime',
    base: { power: 6, rate: 6, speed: 7, armor: 3, energy: 7 },
    cap: { power: 10, rate: 10, speed: 10, armor: 6, energy: 10 },
    special: 'strafingrun', passive: 'hdash', cls: 'jet',
    blurbFa: 'افسانهٔ آسمان کارگاه — سریع‌ترین بال با سنگین‌ترین رگبار.',
    blurbEn: 'Legend of the workshop sky — the fastest wing with the heaviest rain.',
  },
];

/** The full 16-vehicle roster: 8 legacy tanks + 3 helis + 3 drones + 2 jets. */
export const FLEET: TankSpec[] = [...TANKS, ...HELICOPTERS, ...DRONES, ...AIRCRAFT];

export const VEHICLE_BY_ID: Record<string, TankSpec> = Object.fromEntries(FLEET.map((v) => [v.id, v]));

/** Lookup across the WHOLE fleet (kept name for save-shape compatibility). */
export const TANK_BY_ID: Record<string, TankSpec> = VEHICLE_BY_ID;

/** Effective stat after `tier` upgrades (tiers 0…5). Tier 5 reaches the cap. */
export function effStat(tank: TankSpec, stat: TTStat, upgrades: Record<string, number>): number {
  const tier = clamp(upgrades[`${tank.id}:${stat}`] ?? 0, 0, 5);
  const base = tank.base[stat];
  const cap = tank.cap[stat];
  return base + ((cap - base) * tier) / 5;
}

/** Upgrade cost for the NEXT tier (current tier passed in). */
export function upgradeCost(tank: TankSpec, currentTier: number): number {
  const unit = Math.max(90, Math.round(tank.price * 0.22 + 90));
  return Math.round((unit * (currentTier + 1)) / 10) * 10;
}

/* =============================== missions ============================== */

export type MissionKind = 'clear' | 'survive' | 'siege' | 'boss';

export interface MissionDef {
  level: number;          // 1-based
  index: number;          // 0-based within the level
  kind: MissionKind;
  seed: number;           // level * 1000 + index
  /* CLEAR */
  waves: number;
  perWave: number;
  /* SURVIVE */
  surviveMs: number;
  /* SIEGE */
  genHp: number;
  guard: number;          // initial defenders
  reinforceMs: number;
  /* BOSS */
  bossPhases: number;
  /* R12-c — optional advisory hint shown in the briefing (never required) */
  recClass: VehicleClass;
  /* shared scaling */
  droneHp: number;
  droneSpeed: number;
  fireMs: number;
  plasmaSpeed: number;
  spawnCap: number;
  parMs: number;
}

/** missions per level — documented formula: 4 + ((L * 7) % 16) → 4…19 */
export function missionsInLevel(level: number): number {
  return 4 + ((level * 7) % 16);
}

/** Deterministic mission generation. */
export function buildMission(level: number, index: number): MissionDef {
  const seed = level * 1000 + index;
  const rng = mulberry32(seed);
  const kinds: MissionKind[] = ['clear', 'survive', 'siege'];
  let kind = kinds[index % 3];
  const isLast = index === missionsInLevel(level) - 1;
  if (level % 4 === 0 && isLast) kind = 'boss';

  const waves = clamp(2 + Math.floor(level / 9) + (index >= 6 ? 1 : 0), 2, 4);
  const perWave = clamp(2 + Math.floor((level + index) / 4), 2, 7);
  const surviveMs = clamp((28 + index * 5 + level * 2) * 1000, 28_000, 95_000);
  const genHp = 24 + level * 2;
  const guard = clamp(2 + Math.floor((level + index) / 6), 2, 5);
  const reinforceMs = clamp(11_000 - level * 120, 6_500, 11_000);
  const bossPhases = level <= 12 ? 2 : 3;

  const droneHp = clamp(1 + Math.floor((level + index) / 13), 1, 4);
  const droneSpeed = clamp(1.45 + level * 0.032 + index * 0.02, 1.4, 3.3); // never above the player
  const fireMs = clamp(2500 - level * 26 - index * 20, 780, 2500);
  const plasmaSpeed = clamp(4.1 + level * 0.03, 4.1, 5.4);
  const spawnCap = clamp(4 + Math.floor(level / 8), 4, 8);

  const parMs =
    kind === 'clear' ? (waves * perWave * 9000 + waves * 3000) :
    kind === 'survive' ? surviveMs + 12_000 :
    kind === 'siege' ? (genHp * 1400 + guard * 6000) :
    (240 + level * 6) * 1000;

  /* R12-c — ADVISORY ONLY: the recommended class is a briefing hint, never a
   * gate. Every mission stays completable with any owned vehicle, including
   * the free starter tank (objective kinds are class-agnostic by design). */
  const recRng = mulberry32(seed * 131 + 7);
  const roll = recRng();
  let recClass: VehicleClass = 'tank';
  if (kind === 'siege') recClass = roll < 0.45 ? 'drone' : roll < 0.8 ? 'heli' : 'tank';
  else if (kind === 'boss') recClass = roll < 0.6 ? 'tank' : 'heli';
  else recClass = roll < 0.42 ? 'tank' : roll < 0.62 ? 'heli' : roll < 0.82 ? 'drone' : 'jet';

  return {
    level, index, kind, seed, waves, perWave, surviveMs,
    genHp, guard, reinforceMs, bossPhases, recClass,
    droneHp, droneSpeed, fireMs, plasmaSpeed, spawnCap, parMs,
  };
}

/* ============================ arena layout ============================= */

export interface TTArena {
  walls: TTWall[];
  playerSpawn: { x: number; y: number };
  droneSpawns: { x: number; y: number }[];
  genSpot: { x: number; y: number } | null;
  theme: number; // 0…3 rotating neon palette
}

/**
 * Deterministic symmetric obstacle field. Obstacles are isolated islands on a
 * coarse mirrored grid, so no pocket can ever seal the player in.
 */
export function buildArena(m: MissionDef): TTArena {
  const rng = mulberry32(m.seed * 77 + 13);
  const walls: TTWall[] = [];
  const density = clamp(0.22 + m.level * 0.008, 0.22, 0.5);
  const cols = 6;
  const rows = 4;
  const cw = (WORLD_W - 2 * PAD) / cols;
  const ch = (WORLD_H - 2 * PAD) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < Math.ceil(cols / 2); c++) {
      if (rng() > density) continue;
      // skip the middle band where the player spawns (bottom row centre)
      const w = Math.round(cw * (0.34 + rng() * 0.5));
      const h = Math.round(ch * (0.3 + rng() * 0.55));
      const x = Math.round(PAD + c * cw + (cw - w) * rng());
      const y = Math.round(PAD + r * ch + (ch - h) * rng());
      if (w < 34 || h < 30) continue;
      walls.push({ x, y, w, h });
      const mx = WORLD_W - x - w; // mirror
      if (mx !== x) walls.push({ x: mx, y, w, h });
    }
  }

  // central pillar pair for cover (skip on siege — the generator lives there)
  if (m.kind !== 'siege' && rng() < 0.75) {
    walls.push({ x: WORLD_W / 2 - 130, y: WORLD_H / 2 - 20, w: 96, h: 40 });
    walls.push({ x: WORLD_W / 2 + 34, y: WORLD_H / 2 - 20, w: 96, h: 40 });
  }

  const playerSpawn = { x: WORLD_W / 2, y: WORLD_H - PAD - 60 };

  // prune walls overlapping the player spawn
  const safe = walls.filter((w) => !(
    playerSpawn.x > w.x - 70 && playerSpawn.x < w.x + w.w + 70 &&
    playerSpawn.y > w.y - 70 && playerSpawn.y < w.y + w.h + 70
  ));

  const spawns: { x: number; y: number }[] = [];
  const spots = 8;
  for (let i = 0; i < spots; i++) {
    const a = (Math.PI * 2 * i) / spots + rng() * 0.4;
    const rad = 260 + rng() * 180;
    const sx = clamp(WORLD_W / 2 + Math.cos(a) * rad, PAD + 60, WORLD_W - PAD - 60);
    const sy = clamp(WORLD_H / 2 + Math.sin(a) * rad * 0.72, PAD + 60, WORLD_H - PAD - 90);
    spawns.push({ x: sx, y: sy });
  }

  const genSpot = m.kind === 'siege' || m.kind === 'boss'
    ? { x: WORLD_W / 2, y: WORLD_H / 2 }
    : null;

  return { walls: safe, playerSpawn, droneSpawns: spawns, genSpot, theme: (m.level - 1) % 4 };
}

export const THEMES = [
  { wall: '#f43f5e', grid: 'rgba(244,63,94,0.07)', frame: 'rgba(244,63,94,0.55)' },
  { wall: '#2dd4bf', grid: 'rgba(45,212,191,0.07)', frame: 'rgba(45,212,191,0.5)' },
  { wall: '#a78bfa', grid: 'rgba(167,139,250,0.07)', frame: 'rgba(167,139,250,0.5)' },
  { wall: '#fbbf24', grid: 'rgba(251,191,36,0.07)', frame: 'rgba(251,191,36,0.5)' },
] as const;

/* ============================ progression ============================= */

export interface TTLevelRec { stars: number[]; cleared: boolean }

export interface TTSave {
  v: 1;
  money: number;
  driverLevel: number;
  driverXp: number;
  levels: Record<string, TTLevelRec>;
  ownedTanks: string[];
  upgrades: Record<string, number>; // `${tankId}:${stat}` → tier 0…5
  selectedTank: string;
  stats: { missions: number; kills: number; bossKills: number; deaths: number; bestScore: number; perfect: number };
}

export const TT_SAVE_KEY = 'doi_tinktank_v1';

export function defaultSave(): TTSave {
  return {
    v: 1,
    money: 120,
    driverLevel: 1,
    driverXp: 0,
    levels: {},
    ownedTanks: ['rustbucket'],
    upgrades: {},
    selectedTank: 'rustbucket',
    stats: { missions: 0, kills: 0, bossKills: 0, deaths: 0, bestScore: 0, perfect: 0 },
  };
}

export function loadTTSave(): TTSave {
  try {
    const raw = localStorage.getItem(TT_SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<TTSave>;
    const d = defaultSave();
    return {
      v: 1,
      money: typeof parsed.money === 'number' ? parsed.money : d.money,
      driverLevel: Math.max(1, parsed.driverLevel ?? 1),
      driverXp: Math.max(0, parsed.driverXp ?? 0),
      levels: parsed.levels ?? {},
      ownedTanks: Array.isArray(parsed.ownedTanks) && parsed.ownedTanks.length ? parsed.ownedTanks : d.ownedTanks,
      upgrades: parsed.upgrades ?? {},
      selectedTank: TANK_BY_ID[parsed.selectedTank ?? ''] ? parsed.selectedTank! : d.selectedTank,
      stats: { ...d.stats, ...(parsed.stats ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function saveTTSave(s: TTSave): void {
  try { localStorage.setItem(TT_SAVE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/** XP needed to advance FROM `level` to `level + 1`. */
export function driverNeed(level: number): number {
  return 100 + 50 * (level - 1);
}

/** Add XP, resolve level-ups; returns levels gained. Mutates `s`. */
export function addDriverXp(s: TTSave, xp: number): number {
  s.driverXp += Math.max(0, Math.round(xp));
  let gained = 0;
  while (s.driverXp >= driverNeed(s.driverLevel)) {
    s.driverXp -= driverNeed(s.driverLevel);
    s.driverLevel += 1;
    gained += 1;
  }
  return gained;
}

export interface MissionReward {
  money: number;
  xp: number;
  newStars: number;
  firstClear: boolean;
}

/** Money: first clear 50 + 12·level (+25 per new star), replay 30% of base. */
export function missionReward(m: MissionDef, firstClear: boolean, newStars: number, starsNow: number): MissionReward {
  const base = 50 + 12 * m.level;
  const money = (firstClear ? base : Math.round(base * 0.3)) + 25 * newStars;
  const xp = 20 + 15 * starsNow;
  return { money, xp, newStars, firstClear };
}

/** Level-unlock rule: level N unlocks when level N−1 is fully completed. */
export function isLevelUnlocked(save: TTSave, level: number): boolean {
  if (level <= 1) return true;
  const prev = save.levels[String(level - 1)];
  return !!prev?.cleared;
}

/** Mission-unlock rule inside a level: sequential. */
export function isMissionUnlocked(save: TTSave, level: number, index: number): boolean {
  if (!isLevelUnlocked(save, level)) return false;
  if (index === 0) return true;
  const rec = save.levels[String(level)];
  return !!rec && rec.stars[index - 1] > 0;
}

export function totalStars(save: TTSave): number {
  let n = 0;
  for (const rec of Object.values(save.levels)) n += rec.stars.reduce((a, b) => a + b, 0);
  return n;
}

/* ============================ display names ============================ */

export function tankName(tank: TankSpec, locale: Locale): string {
  return locale === 'fa' || locale === 'ar' ? tank.nameFa : tank.nameEn;
}

export function tankBlurb(tank: TankSpec, locale: Locale): string {
  return locale === 'fa' || locale === 'ar' ? tank.blurbFa : tank.blurbEn;
}
