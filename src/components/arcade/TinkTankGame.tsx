'use client';

/**
 * TinkTankGame — "TINKTANK" (تینک‌تانک) — task A1 rework of Mind Tank.
 *
 * A full tank-progression campaign: 40 levels × 4–19 procedural missions
 * (CLEAR / SURVIVE / SIEGE + a BOSS every 4th level), an 8-tank garage with
 * five upgrade tracks each, an in-game credit economy persisted in
 * localStorage (`doi_tinktank_v1`), and a neon canvas battlefield with a
 * smooth camera, glow trails, particles and telegraphed enemy patterns.
 *
 * Platform integration:
 *  - shared arcade economy via submitArcade('mazemind', …) — the internal id
 *    stays 'mazemind' so leaderboard/economy history is continuous;
 *  - RetroBoot super-retro opening before the main menu;
 *  - useGameSession(true) hides platform chrome / fullscreen on touch;
 *  - perfMode halves particles, disables shake and caps DPR at 1.
 *
 * Controls — desktop: WASD/arrows move, mouse aim, click/Space fire,
 * Shift special, Esc pause. Touch: left floating stick (move), right drag
 * (aim), dedicated FIRE + SPECIAL buttons (multi-touch, pointer events).
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/store/app';
import { localizeDigits, type Locale } from '@/lib/i18n';
import { sfx } from '@/lib/sound';
import { useGameSession, isTouchDevice } from '@/lib/immersive';
import { submitArcade, announceArcadeRewards, ArcadeResultModal, type ArcadeSubmitResult } from '@/lib/arcade-client';
import { Button } from '@/components/ui/button';
import { RetroBoot } from '@/components/shared/RetroBoot';
import {
  Crosshair, Heart, Lock, Pause, Play, Rocket, Shield, Star, Swords, Timer, Trophy, Wrench, X, Zap,
} from 'lucide-react';
import {
  WORLD_W, WORLD_H, PAD, THEMES,
  TANKS, TANK_BY_ID, TT_STATS as TANK_STATS,
  FLEET, vehicleClass, passiveKey,
  effStat, upgradeCost, tankName, tankBlurb, defaultSave,
  buildMission, buildArena, missionsInLevel,
  loadTTSave, saveTTSave, addDriverXp, driverNeed, missionReward,
  isLevelUnlocked, isMissionUnlocked, totalStars, mulberry32, clamp,
  type TankSpec, type TTStat, type TTSave, type MissionDef, type TTWall, type TTArena, type VehicleClass,
} from '@/lib/game/tinktank-data';
import {
  drawVehicle, drawHexShield, drawShockwave, drawEmpPulse, drawHangarPreview, drawUpgradeDiagram, tiersOf,
  type UpgradeTiers,
} from '@/lib/game/tinktank-render';

/* ============================== tuning ================================= */
/* Speeds are "frame units" at the 60 fps reference step (step = dt/16.67). */

const VIEW_W = 900;          // logical camera viewport (world units)
const VIEW_H = 540;
const PLAYER_R = 14;
const BULLET_R = 5.4;
const PLASMA_R = 5.8;
const DRONE_R = 15;
const BOSS_R = 46;
const GEN_HALF = 40;         // generator half-size
const INV_MS = 950;          // post-hit invulnerability
const PICKUP_LIFE = 11_000;
const DROP_CHANCE = 0.3;
const HEAT_PER_SHOT = 7;
const HEAT_COOL = 30;        // per second
const HEAT_COOL_IDLE = 46;   // per second when not firing
const HEAT_MAX = 100;
const HEAT_UNLOCK = 45;
const MAX_PARTS = 320;
const MAX_TRAIL = 9;

/* R12-c class tuning */
const BOMB_CD = 1100;         // drone bomb cooldown
const BOMB_COST = 18;         // drone bomb energy cost
const BOMB_FUSE = 900;        // delay-fuse flight time (ms)
const BOMB_SPLASH = 74;
const DASH_MS = 950;          // jet strafing-run duration
const DASH_SPEED = 13.5;
const RAIN_MS = 70;           // bullet-rain interval during the dash
const RECON_MS = 9000;        // raven_eye radar reveal window

const SCORE_KILL_BASE = 40;
const SCORE_BOSS = 800;
const SCORE_WAVE = 60;
const SCORE_WIN = 250;
const SCORE_PERFECT = 150;

/* ============================== types ================================== */

type Phase = 'banner' | 'playing' | 'paused' | 'won' | 'lost';
type Screen = 'boot' | 'menu' | 'levels' | 'level' | 'brief' | 'game' | 'garage' | 'howto' | 'stats';
type DroneKind = 'scout' | 'gunner' | 'sniper' | 'boss';

interface Drone {
  id: number; kind: DroneKind;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  state: 'spawn' | 'patrol' | 'chase' | 'aim';
  spawnT: number; fireT: number; aimT: number; losLost: number; stuckT: number;
  bodyAng: number; gunAng: number; wp: { x: number; y: number };
  orbitDir: number; dodgeT: number; dodgeAng: number; flashT: number; spin: number;
  /* R12-c — marked by the recon radar (revealed + aim-priority) */
  markedT?: number;
  /* boss only */
  phase?: number; burstT?: number; burstN?: number; ringT?: number; spiralAng?: number; minionT?: number;
  stunT?: number;
}
interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number;
  life: number; friendly: boolean; color: string;
  splash?: number; pierce?: boolean; hits?: number[]; molten?: boolean;
  /* R12-c — per-class tracer/bullet styles (undefined → classic shell/plasma) */
  kind?: 'rocket' | 'mini' | 'streak' | 'bomb';
}
interface Generator {
  x: number; y: number; hp: number; maxHp: number; pulseT: number; spin: number; flashT: number;
}
interface Pickup { id: number; x: number; y: number; kind: 'shield' | 'repair' | 'energy'; t: number; life: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number }
interface Pop { x: number; y: number; txt: string; c: string; life: number; max: number }
interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; c: string }
interface Decal { x: number; y: number; ang: number; life: number; max: number }
interface Boom { x: number; y: number; t: number; max: number; r: number; kind: 'boom' | 'emp' }

interface TankParams {
  damage: number; fireCd: number; speed: number; maxHp: number; energyRate: number;
  chain: boolean; splash: boolean; pierce: boolean; blink: boolean; regen: boolean;
  special: TankSpec['special'];
  /* R12-c class identity */
  cls: VehicleClass;
  air: boolean;      // drones fly clean over walls
  hover: boolean;    // helis hover over obstacles (damped, not blocked)
  strafe: boolean;   // heli lateral strafe controls
  bomb: boolean;     // drone delay-fuse bomb button
  dash: boolean;     // jet strafing-run special
}

interface RunResult {
  won: boolean;
  score: number;
  stars: number;
  timeMs: number;
  hits: number;
  acc: number;
  kills: number;
  bossKill: boolean;
}

interface Game {
  phase: Phase;
  mission: MissionDef;
  arena: TTArena;
  params: TankParams;
  color: string; glow: string;
  /* player */
  px: number; py: number; pvx: number; pvy: number;
  hullAng: number; gunAng: number; bank: number;
  hp: number; fireT: number; invT: number; heat: number; overheated: boolean;
  energy: number; buffT: number; shieldHits: number; shieldT: number; regenT: number;
  muzzleT: number; hitsTaken: number; kills: number; bossKill: boolean;
  shots: number; hitCount: number;
  trail: { x: number; y: number }[];
  /* R12-c class state */
  cls: VehicleClass; air: boolean; hover: boolean;
  dashT: number; dashAng: number; rainT: number; bombCd: number; reconT: number;
  decals: Decal[]; booms: Boom[];
  decalT: number; exhaustT: number; smokeT: number;
  /* objective state */
  wave: number; waveQueue: number; spawnT: number; surviveT: number; halfShown: boolean; finalShown: boolean;
  gen: Generator | null; chainDown: number; chainNext: number;
  bossSpawned: boolean;
  /* fx + input */
  camX: number; camY: number; shake: number; hitFlash: number; time: number; bannerT: number;
  keys: Set<string>;
  aim: { x: number; y: number }; aimMode: 'mouse' | 'manual' | 'auto';
  stick: { active: boolean; id: number; ox: number; oy: number; dx: number; dy: number };
  drones: Drone[]; bullets: Bullet[]; pickups: Pickup[]; parts: Part[]; pops: Pop[]; beams: Beam[];
  startedAt: number; elapsed: number;
}

interface HudMirror {
  hp: number; maxHp: number; heat: number; energy: number; score: number;
  wave: number; waves: number; left: number; timeLeft: number;
  bossFrac: number; genFrac: number; specialPct: number; overheated: boolean; shield: boolean;
}

/* ============================ math helpers ============================= */

function angLerp(a: number, b: number, k: number) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * k;
}

function circleRect(px: number, py: number, r: number, w: TTWall) {
  const cx = clamp(px, w.x, w.x + w.w);
  const cy = clamp(py, w.y, w.y + w.h);
  const dx = px - cx;
  const dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, pen: r - d };
  }
  const l = px - w.x;
  const rt = w.x + w.w - px;
  const t = py - w.y;
  const b = w.y + w.h - py;
  const m = Math.min(l, rt, t, b);
  if (m === l) return { nx: -1, ny: 0, pen: r + l };
  if (m === rt) return { nx: 1, ny: 0, pen: r + rt };
  if (m === t) return { nx: 0, ny: -1, pen: r + t };
  return { nx: 0, ny: 1, pen: r + b };
}

function segHitsRect(x1: number, y1: number, x2: number, y2: number, w: TTWall) {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - w.x, w.x + w.w - x1, y1 - w.y, w.y + w.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

function hasLOS(x1: number, y1: number, x2: number, y2: number, walls: TTWall[]) {
  for (const w of walls) if (segHitsRect(x1, y1, x2, y2, w)) return false;
  return true;
}

function pointFree(x: number, y: number, r: number, walls: TTWall[]) {
  for (const w of walls) if (circleRect(x, y, r, w)) return false;
  return true;
}

function resolveWalls(x: number, y: number, r: number, vx: number, vy: number, e: number, walls: TTWall[]) {
  for (const w of walls) {
    const c = circleRect(x, y, r, w);
    if (!c) continue;
    x += c.nx * c.pen;
    y += c.ny * c.pen;
    const vn = vx * c.nx + vy * c.ny;
    if (vn < 0) {
      vx -= (1 + e) * vn * c.nx;
      vy -= (1 + e) * vn * c.ny;
    }
  }
  return { x, y, vx, vy };
}

function resolveBounds(x: number, y: number, r: number, vx: number, vy: number, e: number) {
  let hit = false;
  if (x < PAD + r) { x = PAD + r; if (vx < 0) { vx = -vx * e; hit = true; } }
  if (x > WORLD_W - PAD - r) { x = WORLD_W - PAD - r; if (vx > 0) { vx = -vx * e; hit = true; } }
  if (y < PAD + r) { y = PAD + r; if (vy < 0) { vy = -vy * e; hit = true; } }
  if (y > WORLD_H - PAD - r) { y = WORLD_H - PAD - r; if (vy > 0) { vy = -vy * e; hit = true; } }
  return { x, y, vx, vy, hit };
}

function interceptAngle(sx: number, sy: number, tx: number, ty: number, tvx: number, tvy: number, speed: number) {
  const dx = tx - sx;
  const dy = ty - sy;
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  let t = -1;
  if (Math.abs(a) < 1e-4) {
    if (Math.abs(b) > 1e-4) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2);
      if (t < 0) t = Math.max(t1, t2);
    }
  }
  if (!Number.isFinite(t) || t < 0) t = Math.hypot(dx, dy) / speed;
  t = Math.min(t, 400);
  return Math.atan2(dy + tvy * t, dx + tvx * t);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* ===================== tank stat derivation ============================ */

function computeParams(tank: TankSpec, upgrades: Record<string, number>): TankParams {
  const p = effStat(tank, 'power', upgrades);
  const rate = effStat(tank, 'rate', upgrades);
  const spd = effStat(tank, 'speed', upgrades);
  const arm = effStat(tank, 'armor', upgrades);
  const en = effStat(tank, 'energy', upgrades);
  const cls = vehicleClass(tank);

  /* class feel — every class keeps the SAME 5 upgrade tracks but derives
   * different combat stats so each one handles distinctly in the arena. */
  let damage: number;
  let fireCd: number;
  let speed: number;
  let maxHp: number;
  let energyRate: number;
  if (cls === 'heli') {
    damage = 1 + Math.floor(p / 3.3);            // rocket punch
    fireCd = Math.round(340 - rate * 19);
    speed = 2.5 + spd * 0.21;
    maxHp = 1 + Math.round(arm * 0.85);          // fragile airframe
    energyRate = 4.2 + en * 0.6;
  } else if (cls === 'drone') {
    damage = Math.max(1, 1 + Math.floor(p / 4)); // light minigun
    fireCd = Math.round(300 - rate * 18);
    speed = 2.8 + spd * 0.26;                    // very fast
    maxHp = 1 + Math.round(arm * 0.6);           // very fragile
    energyRate = 4.5 + en * 0.65;
  } else if (cls === 'jet') {
    damage = 1 + Math.floor(p / 3.6);
    fireCd = Math.round(320 - rate * 18);
    speed = 2.7 + spd * 0.24;
    maxHp = 2 + Math.round(arm * 0.7);           // fragile
    energyRate = 4 + en * 0.6;                   // long-cooldown energy loop
  } else {
    damage = 1 + Math.floor(p / 3.2);
    fireCd = Math.round(380 - rate * 20);
    speed = 2.55 + spd * 0.2;
    maxHp = 2 + Math.round(arm);
    energyRate = 3.6 + en * 0.55;
  }

  return {
    damage, fireCd, speed, maxHp, energyRate,
    chain: tank.id === 'tesla',
    splash: tank.id === 'volcano' || cls === 'heli', // heli rockets splash a little
    pierce: tank.id === 'prism',
    blink: tank.id === 'mirage' || tank.id === 'wasp',
    regen: tank.id === 'omega',
    special: tank.special,
    cls,
    air: cls === 'drone',
    hover: cls === 'heli',
    strafe: cls === 'heli',
    bomb: cls === 'drone',
    dash: cls === 'jet',
  };
}

const DRONE_KIND_COLORS: Record<DroneKind, string> = {
  scout: '#4ade80', gunner: '#38bdf8', sniper: '#c084fc', boss: '#f43f5e',
};

function droneKindFor(m: MissionDef, i: number): DroneKind {
  const rng = mulberry32(m.seed * 31 + i * 7);
  const roll = rng();
  if (m.level >= 3 && roll < 0.22) return 'sniper';
  if (roll < 0.5) return 'scout';
  return 'gunner';
}

/* ============================ component ================================ */

export function TinkTankGame({ onExit }: { onExit: () => void }) {
  const { t, locale, perfMode } = useApp();
  const rtl = locale === 'fa' || locale === 'ar';

  useGameSession(true);

  const [booted, setBooted] = useState(false);
  const [screen, setScreen] = useState<Screen>('menu');
  const [save, setSave] = useState<TTSave>(() => defaultSave());
  const [saveLoaded, setSaveLoaded] = useState(false);
  const [selLevel, setSelLevel] = useState(1);
  const [selMission, setSelMission] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('banner');
  const [banner, setBanner] = useState<{ text: string; sub?: string; danger?: boolean; key: number } | null>(null);
  const [hud, setHud] = useState<HudMirror | null>(null);
  const [result, setResult] = useState<{ r: RunResult; money: number; xp: number; firstClear: boolean; newStars: number; levelCleared: boolean; rewards: ArcadeSubmitResult | null } | null>(null);
  const [levelModal, setLevelModal] = useState<{ score: number; money: number; stars: number; starsMax: number; rewards: ArcadeSubmitResult | null } | null>(null);
  const [hasTouch, setHasTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [garTab, setGarTab] = useState<VehicleClass | 'all'>('all');

  const gRef = useRef<Game | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const saveRef = useRef(save);
  const fireKeyRef = useRef(false);
  const fireMouseRef = useRef(false);
  const fireBtnRef = useRef(false);
  const strafeLRef = useRef(false);   // R12-c heli strafe
  const strafeRRef = useRef(false);
  const stickTapRef = useRef(0);
  const bannerKeyRef = useRef(1);
  const endRef = useRef<(r: RunResult) => void>(() => undefined);
  const selLevelRef = useRef(1);
  const selMissionRef = useRef(0);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    endRef.current = (r) => finishMission(r);
  }, []);

  /* load save + touch detection once (client) */
  useEffect(() => {
    setSave(loadTTSave());
    setSaveLoaded(true);
    setHasTouch(isTouchDevice());
    const orient = () => setPortrait(window.innerHeight > window.innerWidth * 1.05);
    orient();
    window.addEventListener('resize', orient);
    window.addEventListener('orientationchange', orient);
    return () => { window.removeEventListener('resize', orient); window.removeEventListener('orientationchange', orient); };
  }, []);

  const persist = useCallback((next: TTSave) => {
    saveTTSave(next);
    setSave({ ...next });
  }, []);

  const showBanner = useCallback((text: string, sub?: string, danger?: boolean) => {
    bannerKeyRef.current += 1;
    setBanner({ text, sub, danger, key: bannerKeyRef.current });
  }, []);

  const dNum = useCallback((n: number | string) => localizeDigits(n, locale), [locale]);

  /* ---------------- mission completion bookkeeping ---------------- */
  const finishMission = (r: RunResult) => {
    const s = saveRef.current;
    const level = selLevelRef.current;
    const index = selMissionRef.current;
    const count = missionsInLevel(level);
    const mission = buildMission(level, index);

    /* stars: win / clean (≤1 hit) / under par */
    let stars = 0;
    if (r.won) {
      stars = 1;
      if (r.hits <= 1) stars += 1;
      if (r.timeMs <= mission.parMs) stars += 1;
    }

    const rec = s.levels[String(level)] ?? { stars: Array.from({ length: count }, () => 0), cleared: false };
    if (rec.stars.length < count) rec.stars = Array.from({ length: count }, (_, i) => rec.stars[i] ?? 0);
    const prevStars = rec.stars[index] ?? 0;
    const firstClear = prevStars === 0;
    const newStars = Math.max(0, stars - prevStars);
    if (r.won) rec.stars[index] = Math.max(prevStars, stars);
    const levelCleared = r.won && index === count - 1;
    if (levelCleared) rec.cleared = true;
    s.levels[String(level)] = rec;

    let money = 0;
    let xp = 0;
    if (r.won) {
      const rw = missionReward(mission, firstClear, newStars, stars);
      money = rw.money + (mission.kind === 'boss' ? 120 : 0);
      xp = rw.xp + 3 * mission.level;
      s.money += money;
      addDriverXp(s, xp);
      s.stats.missions += 1;
      s.stats.kills += r.kills;
      if (r.bossKill) s.stats.bossKills += 1;
      if (r.hits === 0) s.stats.perfect += 1;
      if (r.score > s.stats.bestScore) s.stats.bestScore = r.score;
    } else {
      s.stats.deaths += 1;
    }
    persist(s);

    /* shared platform economy (id stays 'mazemind' for continuity) */
    if (levelCleared) {
      setLevelModal({ score: r.score, money, stars: rec.stars.reduce((a, b) => a + b, 0), starsMax: count * 3, rewards: null });
    }
    if (r.won && useApp.getState().user) {
      submitArcade('mazemind', r.score, { level, mission: index, kind: mission.kind, stars, acc: r.acc })
        .then((res) => {
          if (res) announceArcadeRewards(res);
          if (levelCleared) {
            setLevelModal((prev) => (prev ? { ...prev, rewards: res } : prev));
          } else {
            setResult((prev) => (prev ? { ...prev, rewards: res } : prev));
          }
        })
        .catch(() => undefined);
    }

    if (r.won) sfx.win();
    else sfx.lose();

    if (!levelCleared) setResult({ r, money, xp, firstClear, newStars, levelCleared, rewards: null });
  };

  /* refs mirroring the latest selection for the engine callbacks */
  useEffect(() => { selLevelRef.current = selLevel; selMissionRef.current = selMission; }, [selLevel, selMission]);

  /* ---------------- deploy / retry / leave ---------------- */
  const deploy = useCallback((level: number, index: number) => {
    setSelLevel(level);
    setSelMission(index);
    setResult(null);
    setLevelModal(null);
    setBanner(null);
    setHud(null);
    setPhase('banner');
    setRunKey((k) => k + 1);
    setScreen('game');
    sfx.click();
  }, []);

  const retry = useCallback(() => {
    setRunKey((k) => k + 1);
    setResult(null);
    setLevelModal(null);
    setBanner(null);
    setHud(null);
    setPhase('banner');
    sfx.click();
  }, []);

  const toLevelMap = useCallback(() => {
    gRef.current = null;
    setScreen('level');
    setResult(null);
    setLevelModal(null);
    sfx.click();
  }, []);

  /* ---------------- garage actions ---------------- */
  const buyTank = (tank: TankSpec) => {
    const s = saveRef.current;
    if (s.ownedTanks.includes(tank.id)) return;
    if (s.driverLevel < tank.reqLevel) { sfx.bad(); return; }
    if (s.money < tank.price) { sfx.bad(); toast.error(t('tt_not_enough_money')); return; }
    s.money -= tank.price;
    s.ownedTanks.push(tank.id);
    s.selectedTank = tank.id;
    persist(s);
    sfx.achievement();
    toast.success(`🔧 ${tankName(tank, locale)}`);
  };

  const selectTank = (tank: TankSpec) => {
    const s = saveRef.current;
    if (!s.ownedTanks.includes(tank.id)) return;
    s.selectedTank = tank.id;
    persist(s);
    sfx.click();
  };

  const upgradeStat = (tank: TankSpec, stat: TTStat) => {
    const s = saveRef.current;
    const key = `${tank.id}:${stat}`;
    const tier = s.upgrades[key] ?? 0;
    if (tier >= 5) return;
    const cost = upgradeCost(tank, tier);
    if (s.money < cost) { sfx.bad(); toast.error(t('tt_not_enough_money')); return; }
    s.money -= cost;
    s.upgrades[key] = tier + 1;
    persist(s);
    sfx.levelup();
  };

  /* =================== the simulation / render loop ==================== */
  useEffect(() => {
    if (screen !== 'game') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const saveNow = saveRef.current;
    const tank = TANK_BY_ID[saveNow.selectedTank] ?? TANKS[0];
    const level = selLevelRef.current;
    const index = selMissionRef.current;
    const mission = buildMission(level, index);
    const arena = buildArena(mission);
    const params = computeParams(tank, saveNow.upgrades);
    const tiers = tiersOf(tank, saveNow.upgrades);
    const theme = THEMES[arena.theme];
    const lowFx = perfMode || canvas.clientWidth < 460;
    const dpr = Math.min(perfMode ? 1 : 2, window.devicePixelRatio || 1);

    /* ---- backing store ---- */
    const resize = () => {
      const w = canvas.clientWidth || 640;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * (VIEW_H / VIEW_W) * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const dNum2 = (n: number) => localizeDigits(n, useApp.getState().locale);

    /* ---- game state ---- */
    const g: Game = {
      phase: 'banner',
      mission, arena, params,
      color: tank.color, glow: tank.glow,
      px: arena.playerSpawn.x, py: arena.playerSpawn.y, pvx: 0, pvy: 0,
      hullAng: -Math.PI / 2, gunAng: -Math.PI / 2, bank: 0,
      hp: params.maxHp, fireT: 0, invT: 0, heat: 0, overheated: false,
      energy: 40, buffT: 0, shieldHits: 0, shieldT: 0, regenT: 0,
      muzzleT: 0, hitsTaken: 0, kills: 0, bossKill: false,
      shots: 0, hitCount: 0,
      trail: [],
      cls: params.cls, air: params.air, hover: params.hover,
      dashT: 0, dashAng: 0, rainT: 0, bombCd: 0, reconT: 0,
      decals: [], booms: [],
      decalT: 0, exhaustT: 0, smokeT: 0,
      wave: 0, waveQueue: 0, spawnT: 0, surviveT: mission.surviveMs, halfShown: false, finalShown: false,
      gen: mission.kind === 'siege'
        ? { x: WORLD_W / 2, y: WORLD_H / 2, hp: mission.genHp, maxHp: mission.genHp, pulseT: 4000, spin: 0, flashT: 0 }
        : null,
      chainDown: 0, chainNext: 0,
      bossSpawned: mission.kind !== 'boss',
      camX: clamp(arena.playerSpawn.x - VIEW_W / 2, 0, WORLD_W - VIEW_W),
      camY: clamp(arena.playerSpawn.y - VIEW_H / 2, 0, WORLD_H - VIEW_H),
      shake: 0, hitFlash: 0, time: 0, bannerT: 1700,
      keys: new Set<string>(),
      aim: { x: WORLD_W / 2, y: 100 }, aimMode: 'auto',
      stick: { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 },
      drones: [], bullets: [], pickups: [], parts: [], pops: [], beams: [],
      startedAt: performance.now(), elapsed: 0,
    };
    gRef.current = g;

    let idSeq = 1;
    let finished = false;
    const timers: number[] = [];
    const addTimer = (id: number) => timers.push(id);

    /* ---- factories ---- */
    const burst = (x: number, y: number, c: string, n: number, speed: number) => {
      const cap = lowFx ? Math.ceil(n / 2) : n;
      for (let i = 0; i < cap; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.25 + Math.random() * 0.95);
        g.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 320 + Math.random() * 520, max: 840, c, r: 1.4 + Math.random() * 2.4 });
      }
      if (g.parts.length > (lowFx ? MAX_PARTS / 2 : MAX_PARTS)) g.parts.splice(0, g.parts.length - (lowFx ? MAX_PARTS / 2 : MAX_PARTS));
    };

    const pop = (x: number, y: number, txt: string, c: string) => {
      g.pops.push({ x, y, txt, c, life: 1100, max: 1100 });
    };

    const genWall = (): TTWall | null =>
      g.gen ? { x: g.gen.x - GEN_HALF, y: g.gen.y - GEN_HALF, w: GEN_HALF * 2, h: GEN_HALF * 2 } : null;

    /* ---- R12-c procedural FX helpers ---- */
    const spawnBoom = (x: number, y: number, scale: number, kind: 'boom' | 'emp' = 'boom') => {
      g.booms.push({ x, y, t: 0, max: kind === 'emp' ? 640 : 470, r: (kind === 'emp' ? 215 : 58) * scale, kind });
      if (g.booms.length > 26) g.booms.shift();
    };

    const addDamagePop = (x: number, y: number, dmg: number) => {
      if (lowFx && Math.random() < 0.5) return;
      g.pops.push({ x: x + (Math.random() - 0.5) * 12, y: y - 13, txt: `-${dmg}`, c: '#fda4af', life: 640, max: 640 });
    };

    /* ---- drones ---- */
    const spawnDrone = (kind: DroneKind, x: number, y: number, delay: number) => {
      const m = g.mission;
      let hp = m.droneHp;
      let fireMul = 1;
      if (kind === 'scout') { fireMul = 1.35; }
      if (kind === 'sniper') { fireMul = 1.5; hp += 1; }
      const hpCap = Math.min(hp, 4);
      g.drones.push({
        id: idSeq++, kind, x, y, vx: 0, vy: 0,
        hp: hpCap, maxHp: hpCap,
        state: 'spawn', spawnT: 620 + delay,
        fireT: m.fireMs * fireMul * (0.8 + Math.random() * 0.5),
        aimT: 0, losLost: 0, stuckT: 0,
        bodyAng: Math.random() * Math.PI * 2,
        gunAng: Math.atan2(g.py - y, g.px - x),
        wp: { x, y },
        orbitDir: Math.random() < 0.5 ? 1 : -1,
        dodgeT: 0, dodgeAng: 0, flashT: 0, spin: Math.random() * Math.PI * 2,
        markedT: g.reconT > 0 ? g.reconT : 0,
      });
    };

    const spawnBoss = () => {
      const m = g.mission;
      const hp = 26 + m.level * 2;
      const bx = WORLD_W / 2;
      const by = 170;
      g.drones.push({
        id: idSeq++, kind: 'boss', x: bx, y: by, vx: 0, vy: 0,
        hp, maxHp: hp, state: 'spawn', spawnT: 1400,
        fireT: 1600, aimT: 0, losLost: 0, stuckT: 0,
        bodyAng: 0, gunAng: 0, wp: { x: bx, y: by },
        orbitDir: 1, dodgeT: 0, dodgeAng: 0, flashT: 0, spin: 0,
        phase: 1, burstT: 0, burstN: 0, ringT: 2600, spiralAng: 0, minionT: 9000, stunT: 0,
      });
      g.shake = Math.max(g.shake, 1);
    };

    const pickSpawn = (): { x: number; y: number } => {
      const spots = g.arena.droneSpawns;
      for (let i = 0; i < 8; i++) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        if (Math.hypot(s.x - g.px, s.y - g.py) > 260 && pointFree(s.x, s.y, DRONE_R + 8, g.arena.walls)) return s;
      }
      const s = spots[Math.floor(Math.random() * spots.length)];
      return { x: s.x, y: s.y };
    };

    const freePointNear = (x: number, y: number, r: number): { x: number; y: number } => {
      if (pointFree(x, y, r, g.arena.walls)) return { x, y };
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 110;
        const nx = clamp(x + Math.cos(a) * d, PAD + 30, WORLD_W - PAD - 30);
        const ny = clamp(y + Math.sin(a) * d, PAD + 30, WORLD_H - PAD - 30);
        if (pointFree(nx, ny, r, g.arena.walls)) return { x: nx, y: ny };
      }
      return { x: g.arena.playerSpawn.x, y: g.arena.playerSpawn.y };
    };

    const deactivateDrone = (d: Drone, idx: number) => {
      const col = DRONE_KIND_COLORS[d.kind];
      /* R12-c — bigger explosions: shockwave ring + flash + debris */
      spawnBoom(d.x, d.y, d.kind === 'boss' ? 2.1 : 0.9);
      burst(d.x, d.y, col, d.kind === 'boss' ? 42 : 15, d.kind === 'boss' ? 4.4 : 3);
      burst(d.x, d.y, '#fbbf24', d.kind === 'boss' ? 26 : 8, 2.2);
      if (!lowFx) {
        for (let i = 0; i < (d.kind === 'boss' ? 10 : 5); i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 1 + Math.random() * 2.4;
          g.parts.push({ x: d.x, y: d.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1000 + Math.random() * 500, max: 1500, c: i % 2 === 0 ? '#334155' : '#475569', r: 1.8 + Math.random() * 1.6 });
        }
      }
      const pts = d.kind === 'boss' ? SCORE_BOSS + g.mission.level * 10 : SCORE_KILL_BASE + g.mission.level * 4;
      g.kills += 1;
      if (d.kind === 'boss') g.bossKill = true;
      pop(d.x, d.y - 18, `+${dNum2(pts)}`, '#fbbf24');
      g.drones.splice(idx, 1);
      g.shake = Math.max(g.shake, d.kind === 'boss' ? 1.4 : 0.35);
      sfx.capture();
      /* loot */
      if (d.kind !== 'boss' && Math.random() < DROP_CHANCE) {
        const spot = freePointNear(d.x, d.y, 12);
        const roll = Math.random();
        const kind: Pickup['kind'] = roll < 0.4 ? 'shield' : roll < 0.72 ? 'repair' : 'energy';
        g.pickups.push({ id: idSeq++, x: spot.x, y: spot.y, kind, t: 0, life: PICKUP_LIFE });
      }
      if (d.kind === 'boss') {
        addTimer(window.setTimeout(() => winMission(), 1000));
      }
    };

    /* ---- mission endings ---- */
    const winMission = () => {
      if (finished || g.phase === 'won' || g.phase === 'lost') return;
      finished = true;
      g.phase = 'won';
      const timeMs = g.elapsed;
      const acc = g.shots > 0 ? Math.round((g.hitCount / g.shots) * 100) : 100;
      let score = SCORE_WIN + g.mission.level * 8;
      score += g.kills * (SCORE_KILL_BASE + g.mission.level * 4);
      if (g.bossKill) score += SCORE_BOSS;
      if (g.hitsTaken === 0) score += SCORE_PERFECT;
      if (timeMs <= g.mission.parMs) score += 80;
      score = Math.min(score, 2000);
      setPhase('won');
      endRef.current({ won: true, score, stars: 0, timeMs, hits: g.hitsTaken, acc, kills: g.kills, bossKill: g.bossKill });
    };

    const loseMission = () => {
      if (finished || g.phase === 'won' || g.phase === 'lost') return;
      finished = true;
      g.phase = 'lost';
      setPhase('lost');
      burst(g.px, g.py, '#fbbf24', 34, 4.4);
      burst(g.px, g.py, '#f87171', 22, 3);
      g.shake = 1.5;
      sfx.bad();
      addTimer(window.setTimeout(() => {
        endRef.current({ won: false, score: 0, stars: 0, timeMs: g.elapsed, hits: g.hitsTaken, acc: 0, kills: g.kills, bossKill: false });
      }, 900));
    };

    const fireBullet = (ang: number) => {
      const p = g.params;
      const cd = p.fireCd * (g.buffT > 0 ? (p.special === 'overdrive' ? 0.45 : p.special === 'frenzy' ? 0.5 : 1) : 1);
      g.fireT = cd;
      const mx = g.px + Math.cos(ang) * (PLAYER_R + 9);
      const my = g.py + Math.sin(ang) * (PLAYER_R + 9);
      const col = g.glow;
      /* per-class primary weapon — same 5 stats, different muzzle feel */
      let speed = 7.6;
      let r = BULLET_R;
      let life = 2600;
      let kind: Bullet['kind'];
      let splash: number | undefined = p.splash ? (g.cls === 'heli' ? 30 : 46) : undefined;
      if (g.cls === 'heli') { speed = 6.6; r = 4.8; kind = 'rocket'; }
      else if (g.cls === 'drone') { speed = 8.6; r = 3.4; kind = 'mini'; splash = undefined; }
      else if (g.cls === 'jet') { speed = 9.4; r = 3.6; kind = 'streak'; splash = undefined; }
      g.bullets.push({ x: mx, y: my, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, life, friendly: true, color: col, splash, pierce: p.pierce, hits: p.pierce ? [] : undefined, kind });
      g.muzzleT = 90;
      burst(mx, my, g.glow, 3, 1.6);
      /* shell casings eject sideways (ground + heli classes) */
      if ((g.cls === 'tank' || g.cls === 'heli') && !lowFx) {
        const ca = ang + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
        g.parts.push({ x: mx, y: my, vx: Math.cos(ca) * (1.4 + Math.random()), vy: Math.sin(ca) * (1.4 + Math.random()), life: 620, max: 620, c: '#fcd34d', r: 1.2 });
      }
      if (g.params.special !== 'overdrive' || g.buffT <= 0) g.heat = Math.min(HEAT_MAX, g.heat + HEAT_PER_SHOT);
      if (g.heat >= HEAT_MAX) { g.overheated = true; sfx.timeout(); }
      sfx.drop();
      g.shots += 1;
    };

    /* R12-c — drone bomb drop: delay-fuse arc, splash on landing */
    const dropBomb = () => {
      if (g.phase !== 'playing' || !g.params.bomb) return;
      if (g.bombCd > 0 || g.energy < BOMB_COST) { sfx.bad(); return; }
      g.energy -= BOMB_COST;
      g.bombCd = BOMB_CD;
      const ang = g.gunAng;
      g.bullets.push({
        x: g.px + Math.cos(ang) * 14, y: g.py + Math.sin(ang) * 14,
        vx: Math.cos(ang) * 4.7, vy: Math.sin(ang) * 4.7,
        r: 6, life: BOMB_FUSE, friendly: true, color: g.glow, kind: 'bomb', splash: BOMB_SPLASH, hits: [],
      });
      g.shots += 1;
      sfx.drop();
    };

    /* R12-c — bomb detonation: splash damage, shockwave, generator hit */
    const explodeBomb = (p: Bullet, idx: number) => {
      const dmg = g.params.damage + 1;
      spawnBoom(p.x, p.y, 1.1);
      burst(p.x, p.y, '#fbbf24', 16, 3.2);
      burst(p.x, p.y, '#f97316', 10, 2.2);
      g.shake = Math.max(g.shake, 0.5);
      for (let j = g.drones.length - 1; j >= 0; j--) {
        const d = g.drones[j];
        if (d.state === 'spawn') continue;
        if (p.hits?.includes(d.id)) continue; // direct-hit target already damaged
        if (Math.hypot(d.x - p.x, d.y - p.y) < BOMB_SPLASH) damageDrone(d, j, 1, p.x, p.y);
      }
      if (g.gen && Math.hypot(g.gen.x - p.x, g.gen.y - p.y) < BOMB_SPLASH + GEN_HALF) hitGenerator(dmg);
      g.bullets.splice(idx, 1);
    };

    const playerSpecial = () => {
      const p = g.params;
      const sp = p.special;
      const cost = sp === 'blink' ? 40 : 100;
      if (g.energy < cost) { sfx.bad(); return; }
      if (sp === 'blink') {
        const dx = g.aim.x - g.px;
        const dy = g.aim.y - g.py;
        const d = Math.hypot(dx, dy) || 1;
        const range = 150;
        let bx = g.px;
        let by = g.py;
        for (let s2 = range; s2 >= 24; s2 -= 12) {
          const cx = g.px + (dx / d) * s2;
          const cy = g.py + (dy / d) * s2;
          if (pointFree(cx, cy, PLAYER_R + 2, g.arena.walls) && cx > PAD + PLAYER_R && cx < WORLD_W - PAD - PLAYER_R && cy > PAD + PLAYER_R && cy < WORLD_H - PAD - PLAYER_R) {
            bx = cx; by = cy; break;
          }
        }
        burst(g.px, g.py, g.glow, 14, 2.6);
        g.px = bx; g.py = by; g.pvx = 0; g.pvy = 0;
        g.invT = Math.max(g.invT, 550);
        g.energy -= cost;
        burst(bx, by, g.glow, 14, 2.6);
        sfx.chat();
        return;
      }
      g.energy = 0;
      g.shake = Math.max(g.shake, 0.8);
      if (sp === 'overdrive' || sp === 'frenzy') {
        g.buffT = sp === 'overdrive' ? 5000 : 4000;
        pop(g.px, g.py - 24, useApp.getState().t('tt_special_ready'), g.glow);
        sfx.levelup();
        return;
      }
      if (sp === 'overshield') {
        g.shieldT = 5000;
        pop(g.px, g.py - 24, useApp.getState().t('tt_sp_overshield'), '#38bdf8');
        sfx.achievement();
        return;
      }
      if (sp === 'shockwave') {
        spawnBoom(g.px, g.py, 1, 'boom');
        burst(g.px, g.py, '#cbd5e1', 26, 4);
        for (let i = g.drones.length - 1; i >= 0; i--) {
          const d = g.drones[i];
          if (d.state === 'spawn') continue;
          const dist = Math.hypot(d.x - g.px, d.y - g.py);
          if (dist < 195) {
            damageDrone(d, i, 3, g.px, g.py);
            const a = Math.atan2(d.y - g.py, d.x - g.px);
            d.vx += Math.cos(a) * 5;
            d.vy += Math.sin(a) * 5;
          }
        }
        sfx.bad();
        return;
      }
      if (sp === 'emp') {
        spawnBoom(g.px, g.py, 1, 'emp');
        burst(g.px, g.py, '#7dd3fc', 30, 4.5);
        for (let i = g.drones.length - 1; i >= 0; i--) {
          const d = g.drones[i];
          if (d.state === 'spawn') continue;
          const dist = Math.hypot(d.x - g.px, d.y - g.py);
          if (dist < 470 && hasLOS(g.px, g.py, d.x, d.y, g.arena.walls)) {
            damageDrone(d, i, 4, g.px, g.py);
            if (d.stunT !== undefined) d.stunT = 1400;
            d.fireT += 1400;
          }
        }
        sfx.achievement();
        return;
      }
      if (sp === 'rocketsalvo') {
        /* R12-c — heli rocket pods: spread salvo with slight splash */
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = g.gunAng + (i - (n - 1) / 2) * 0.16;
          g.bullets.push({
            x: g.px + Math.cos(a) * 16, y: g.py + Math.sin(a) * 16,
            vx: Math.cos(a) * 6.2, vy: Math.sin(a) * 6.2,
            r: 4.8, life: 1900, friendly: true, color: g.glow, kind: 'rocket', splash: 34,
          });
          g.shots += 1;
        }
        g.muzzleT = 140;
        g.shake = Math.max(g.shake, 0.55);
        sfx.bad();
        return;
      }
      if (sp === 'recondar') {
        /* R12-c — recon radar: mark + reveal every target, brief stun */
        g.reconT = RECON_MS;
        for (const d of g.drones) {
          if (d.state === 'spawn') continue;
          d.markedT = RECON_MS;
          if (d.stunT !== undefined) d.stunT = Math.max(d.stunT, 600);
          d.fireT += 600;
        }
        spawnBoom(g.px, g.py, 1, 'emp');
        pop(g.px, g.py - 26, '◉ RADAR', '#2dd4bf');
        sfx.achievement();
        return;
      }
      if (sp === 'carpet') {
        /* R12-c — bomber UAV: staggered row of delay-fuse bombs */
        const dirAng = g.hullAng;
        for (let i = 0; i < 6; i++) {
          const dist = 34 + i * 46;
          const bx = g.px + Math.cos(dirAng) * dist;
          const by = g.py + Math.sin(dirAng) * dist;
          g.bullets.push({
            x: bx, y: by,
            vx: Math.cos(dirAng) * 2.4, vy: Math.sin(dirAng) * 2.4,
            r: 6, life: BOMB_FUSE + i * 120, friendly: true, color: g.glow, kind: 'bomb', splash: 62, hits: [],
          });
          g.shots += 1;
        }
        g.shake = Math.max(g.shake, 0.4);
        sfx.bad();
        return;
      }
      if (sp === 'strafingrun') {
        /* R12-c — jet boost dash across the arena with bullet rain */
        g.dashT = DASH_MS;
        g.dashAng = g.gunAng;
        g.rainT = 0;
        g.invT = Math.max(g.invT, 260);
        g.shake = Math.max(g.shake, 0.7);
        burst(g.px, g.py, g.glow, 18, 3.4);
        sfx.levelup();
        return;
      }
      if (sp === 'nova') {
        for (let i = 0; i < 14; i++) {
          const a = (Math.PI * 2 * i) / 14;
          g.bullets.push({ x: g.px, y: g.py, vx: Math.cos(a) * 5.4, vy: Math.sin(a) * 5.4, r: BULLET_R, life: 1700, friendly: true, color: '#fdba74', splash: 44, molten: true });
        }
        sfx.bad();
        return;
      }
      if (sp === 'beam') {
        const len = 660;
        const x2 = g.px + Math.cos(g.gunAng) * len;
        const y2 = g.py + Math.sin(g.gunAng) * len;
        g.beams.push({ x1: g.px, y1: g.py, x2, y2, life: 240, c: g.glow });
        for (let i = g.drones.length - 1; i >= 0; i--) {
          const d = g.drones[i];
          if (d.state === 'spawn') continue;
          if (segCircle(g.px, g.py, x2, y2, d.x, d.y, DRONE_R + 6)) damageDrone(d, i, 4, g.px, g.py);
        }
        if (g.gen) {
          const gw = genWall();
          if (gw && segHitsRect(g.px, g.py, x2, y2, gw)) hitGenerator(4);
        }
        sfx.achievement();
      }
    };

    const segCircle = (x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy || 1;
      let tt = ((cx - x1) * dx + (cy - y1) * dy) / l2;
      tt = clamp(tt, 0, 1);
      const px2 = x1 + dx * tt;
      const py2 = y1 + dy * tt;
      return Math.hypot(cx - px2, cy - py2) <= r;
    };

    const damageDrone = (d: Drone, idx: number, dmg: number, fx: number, fy: number) => {
      d.hp -= dmg;
      d.flashT = 130;
      d.vx += (fx ? (d.x - fx) / (Math.hypot(d.x - fx, d.y - fy) || 1) : 0) * 0.6;
      d.vy += (fy ? (d.y - fy) / (Math.hypot(d.x - fx, d.y - fy) || 1) : 0) * 0.6;
      burst(d.x, d.y, DRONE_KIND_COLORS[d.kind], 7, 2);
      if (!lowFx) burst(d.x, d.y, '#ffffff', 3, 3.4); // hit sparks
      addDamagePop(d.x, d.y - 8, dmg);                // damage numbers
      g.hitCount += 1;
      if (d.hp <= 0) deactivateDrone(d, idx);
      else sfx.chat();
    };

    const hitGenerator = (dmg: number) => {
      if (!g.gen) return;
      g.gen.hp -= dmg;
      g.gen.flashT = 140;
      burst(g.gen.x, g.gen.y - 10, '#f43f5e', 8, 2.4);
      if (g.gen.hp <= 0 && g.chainDown === 0 && g.chainNext === 0) {
        /* generator down → cascade every remaining defender */
        burst(g.gen.x, g.gen.y, '#fbbf24', 44, 5);
        burst(g.gen.x, g.gen.y, '#f43f5e', 30, 3.4);
        g.shake = 1.5;
        sfx.achievement();
        pop(g.gen.x, g.gen.y - 30, useApp.getState().t('tt_generator_down'), '#f43f5e');
        g.chainDown = g.drones.length;
        g.chainNext = 160;
        g.gen = null;
        addTimer(window.setTimeout(() => winMission(), 1400));
      }
    };

    /* ============================ update ============================ */

    const updatePlayer = (step: number, dt: number) => {
      const p = g.params;
      g.fireT = Math.max(0, g.fireT - dt);
      g.invT = Math.max(0, g.invT - dt);
      g.buffT = Math.max(0, g.buffT - dt);
      g.shieldT = Math.max(0, g.shieldT - dt);
      g.muzzleT = Math.max(0, g.muzzleT - dt);
      g.bombCd = Math.max(0, g.bombCd - dt);
      g.reconT = Math.max(0, g.reconT - dt);
      g.energy = Math.min(100, g.energy + (p.energyRate * dt) / 1000);
      if (p.regen) {
        g.regenT += dt;
        if (g.regenT > 9000 && g.hp < p.maxHp) { g.regenT = 0; g.hp += 1; pop(g.px, g.py - 22, '+♥', '#34d399'); }
      }
      /* heat */
      const cooling = g.heat > 0 ? (g.fireT > 300 ? HEAT_COOL_IDLE : HEAT_COOL) : 0;
      g.heat = Math.max(0, g.heat - (cooling * dt) / 1000);
      if (g.overheated && g.heat <= HEAT_UNLOCK) g.overheated = false;
      g.shake = Math.max(0, g.shake - 0.03 * step);
      g.hitFlash = Math.max(0, g.hitFlash - dt / 500);

      /* movement input */
      let dx = 0;
      let dy = 0;
      const k = g.keys;
      if (k.has('w') || k.has('arrowup')) dy -= 1;
      if (k.has('s') || k.has('arrowdown')) dy += 1;
      if (k.has('a') || k.has('arrowleft')) dx -= 1;
      if (k.has('d') || k.has('arrowright')) dx += 1;
      if (g.stick.active) { dx += g.stick.dx; dy += g.stick.dy; }
      /* R12-c — heli strafe: slide perpendicular to the gun angle */
      if (p.strafe) {
        let sd = 0;
        if (k.has('q') || strafeLRef.current) sd -= 1;
        if (k.has('e') || strafeRRef.current) sd += 1;
        if (sd !== 0) {
          dx += Math.cos(g.gunAng + Math.PI / 2) * sd * 0.9;
          dy += Math.sin(g.gunAng + Math.PI / 2) * sd * 0.9;
        }
      }
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      const spd = p.speed * (g.buffT > 0 && p.special === 'frenzy' ? 1.3 : 1);
      const ease = Math.min(1, 0.22 * step);
      let vx = g.pvx + (dx * spd - g.pvx) * ease;
      let vy = g.pvy + (dy * spd - g.pvy) * ease;
      let x = g.px + vx * step;
      let y = g.py + vy * step;

      /* ---- class movement masks (R12-c) ---- */
      if (g.dashT > 0) {
        /* jet strafing run: locked velocity along the dash, flies over walls */
        g.dashT -= dt;
        const prog = 1 - clamp(g.dashT / DASH_MS, 0, 1);
        const surge = 0.55 + 0.45 * Math.sin(clamp(prog, 0, 1) * Math.PI);
        vx = Math.cos(g.dashAng) * DASH_SPEED * surge;
        vy = Math.sin(g.dashAng) * DASH_SPEED * surge;
        x = g.px + vx * step;
        y = g.py + vy * step;
        g.rainT -= dt;
        while (g.rainT <= 0) {
          g.rainT += RAIN_MS;
          const a = g.dashAng + (Math.random() - 0.5) * 0.5;
          g.bullets.push({
            x: g.px + Math.cos(a) * 12, y: g.py + Math.sin(a) * 12,
            vx: Math.cos(a) * 9.5, vy: Math.sin(a) * 9.5,
            r: 3.4, life: 800, friendly: true, color: g.glow, kind: 'streak', pierce: true, hits: [],
          });
          g.shots += 1;
        }
        if (!lowFx && Math.random() < 0.7) {
          g.parts.push({
            x: x - Math.cos(g.dashAng) * 14, y: y - Math.sin(g.dashAng) * 14,
            vx: -Math.cos(g.dashAng) * 1.2, vy: -Math.sin(g.dashAng) * 1.2,
            life: 420, max: 420, c: g.glow, r: 2.4,
          });
        }
        g.hullAng = angLerp(g.hullAng, g.dashAng, Math.min(1, 0.5 * step));
        g.gunAng = g.dashAng;
        const bd = resolveBounds(x, y, PLAYER_R, vx, vy, 0);
        g.px = bd.x; g.py = bd.y; g.pvx = bd.vx; g.pvy = bd.vy;
        if (g.gen) {
          const gw = genWall()!;
          const c = circleRect(g.px, g.py, PLAYER_R, gw);
          if (c) { g.px += c.nx * c.pen; g.py += c.ny * c.pen; }
        }
      } else if (g.air) {
        /* drones fly clean over walls — bounds + generator only */
        const b2 = resolveBounds(x, y, PLAYER_R, vx, vy, 0);
        x = b2.x; y = b2.y; vx = b2.vx; vy = b2.vy;
        if (g.gen) {
          const gw = genWall()!;
          const c = circleRect(x, y, PLAYER_R, gw);
          if (c) { x += c.nx * c.pen; y += c.ny * c.pen; }
        }
        g.px = x; g.py = y; g.pvx = vx; g.pvy = vy;
      } else if (g.hover) {
        /* helis hover over obstacles: crossing a wall damps speed instead of blocking */
        let over = false;
        for (const w of g.arena.walls) { if (circleRect(x, y, PLAYER_R * 0.85, w)) { over = true; break; } }
        if (over) { vx *= Math.pow(0.85, step); vy *= Math.pow(0.85, step); }
        const b2 = resolveBounds(x, y, PLAYER_R, vx, vy, 0);
        x = b2.x; y = b2.y; vx = b2.vx; vy = b2.vy;
        if (g.gen) {
          const gw = genWall()!;
          const c = circleRect(x, y, PLAYER_R, gw);
          if (c) { x += c.nx * c.pen; y += c.ny * c.pen; }
        }
        g.px = x; g.py = y; g.pvx = vx; g.pvy = vy;
        if (over && Math.random() < 0.25 * step) burst(x, y, 'rgba(148,163,184,0.4)', 1, 0.7);
      } else {
        const res = resolveWalls(x, y, PLAYER_R, vx, vy, 0.15, g.arena.walls);
        x = res.x; y = res.y; vx = res.vx; vy = res.vy;
        if (g.gen) {
          const gw = genWall()!;
          const c = circleRect(x, y, PLAYER_R, gw);
          if (c) { x += c.nx * c.pen; y += c.ny * c.pen; }
        }
        const b = resolveBounds(x, y, PLAYER_R, vx, vy, 0);
        x = b.x; y = b.y; vx = b.vx; vy = b.vy;
        g.px = x; g.py = y; g.pvx = vx; g.pvy = vy;
      }

      const spd2 = Math.hypot(g.pvx, g.pvy);
      if (g.dashT <= 0 && spd2 > 0.4) g.hullAng = angLerp(g.hullAng, Math.atan2(g.pvy, g.pvx), Math.min(1, 0.22 * step));
      /* heli bank — lateral velocity relative to the hull (procedural roll) */
      if (g.hover) {
        const la = g.hullAng + Math.PI / 2;
        g.bank = clamp((g.pvx * Math.cos(la) + g.pvy * Math.sin(la)) / 3, -1, 1);
      }
      /* glow trail */
      if (!lowFx && spd2 > 0.8) {
        g.trail.push({ x: g.px, y: g.py });
        if (g.trail.length > MAX_TRAIL) g.trail.shift();
      } else if (g.trail.length && spd2 <= 0.8) g.trail.shift();

      /* R12-c — ground decals: tread marks behind ground vehicles */
      if (g.cls === 'tank' && !lowFx && spd2 > 1.1) {
        g.decalT -= dt;
        if (g.decalT <= 0) {
          g.decalT = 95;
          const pa = g.hullAng;
          const pxp = Math.cos(pa + Math.PI / 2) * 8.5;
          const pyp = Math.sin(pa + Math.PI / 2) * 8.5;
          g.decals.push({ x: g.px - pxp, y: g.py - pyp, ang: pa, life: 4200, max: 4200 });
          g.decals.push({ x: g.px + pxp, y: g.py + pyp, ang: pa, life: 4200, max: 4200 });
          if (g.decals.length > 90) g.decals.splice(0, g.decals.length - 90);
        }
      }
      /* R12-c — exhaust puffs + damage smoke (procedural ambience) */
      if ((g.cls === 'tank' || g.cls === 'jet') && spd2 > 0.9) {
        g.exhaustT -= dt;
        if (g.exhaustT <= 0) {
          g.exhaustT = g.cls === 'jet' ? 65 : 150;
          g.parts.push({
            x: g.px - Math.cos(g.hullAng) * 13, y: g.py - Math.sin(g.hullAng) * 13,
            vx: -Math.cos(g.hullAng) * 0.5 + (Math.random() - 0.5) * 0.3,
            vy: -Math.sin(g.hullAng) * 0.5 + (Math.random() - 0.5) * 0.3,
            life: 520, max: 520, c: 'rgba(148,163,184,0.45)', r: 2 + Math.random() * 1.6,
          });
        }
      }
      if (g.hp < p.maxHp * 0.4) {
        g.smokeT -= dt;
        if (g.smokeT <= 0) {
          g.smokeT = lowFx ? 430 : 240;
          g.parts.push({
            x: g.px + (Math.random() - 0.5) * 9, y: g.py + (Math.random() - 0.5) * 9,
            vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.4,
            life: 900, max: 900, c: 'rgba(30,41,59,0.6)', r: 2.6 + Math.random() * 2,
          });
        }
      }

      /* aim */
      let targetAng = g.gunAng;
      if (g.dashT > 0) targetAng = g.dashAng;
      else if (g.aimMode === 'mouse' || g.aimMode === 'manual') {
        targetAng = Math.atan2(g.aim.y - g.py, g.aim.x - g.px);
      } else {
        let bestD = Infinity;
        let best: Drone | null = null;
        for (const d of g.drones) {
          if (d.state === 'spawn') continue;
          const dd = Math.hypot(d.x - g.px, d.y - g.py);
          /* recon-marked targets get aim priority, even through walls */
          const sc = dd - (hasLOS(g.px, g.py, d.x, d.y, g.arena.walls) ? 220 : 0) - ((d.markedT ?? 0) > 0 ? 300 : 0);
          if (sc < bestD) { bestD = sc; best = d; }
        }
        if (!best && g.gen) best = null;
        if (best) targetAng = interceptAngle(g.px, g.py, best.x, best.y, best.vx, best.vy, 7.6);
        else if (g.gen) targetAng = Math.atan2(g.gen.y - g.py, g.gen.x - g.px);
      }
      g.gunAng = angLerp(g.gunAng, targetAng, Math.min(1, 0.45 * step));

      /* fire */
      const firing = fireKeyRef.current || fireMouseRef.current || fireBtnRef.current;
      if (firing && !g.overheated && g.fireT <= 0) fireBullet(g.gunAng);
    };

    const droneSpecLocal = (d: Drone) => {
      const m = g.mission;
      let speed = m.droneSpeed;
      let fireMs = m.fireMs;
      let plasma = m.plasmaSpeed;
      if (d.kind === 'scout') { speed *= 1.22; fireMs *= 1.35; }
      if (d.kind === 'sniper') { speed *= 0.72; fireMs *= 1.5; plasma *= 1.45; }
      return { speed: Math.min(speed, 3.3), fireMs, plasma, aimMs: d.kind === 'sniper' ? 900 : 560, dodge: d.kind !== 'sniper' };
    };

    const newWaypoint = (d: Drone) => {
      for (let i = 0; i < 10; i++) {
        const x = PAD + 34 + Math.random() * (WORLD_W - 2 * (PAD + 34));
        const y = PAD + 34 + Math.random() * (WORLD_H - 2 * (PAD + 34));
        if (pointFree(x, y, DRONE_R + 6, g.arena.walls)) { d.wp = { x, y }; return; }
      }
      d.wp = { x: g.arena.playerSpawn.x, y: g.arena.playerSpawn.y };
    };

    const updateDrone = (d: Drone, step: number, dt: number) => {
      d.flashT = Math.max(0, d.flashT - dt);
      d.dodgeT = Math.max(0, d.dodgeT - dt);
      if (d.markedT) d.markedT = Math.max(0, d.markedT - dt);
      if (d.stunT) { d.stunT = Math.max(0, d.stunT - dt); }

      if (d.kind === 'boss') { updateBoss(d, step, dt); return; }

      if (d.state === 'spawn') {
        d.spawnT -= dt;
        d.spin += 0.12 * step;
        if (d.spawnT <= 0) { d.state = 'patrol'; newWaypoint(d); }
        return;
      }
      const spec = droneSpecLocal(d);
      const pdx = g.px - d.x;
      const pdy = g.py - d.y;
      const pd = Math.hypot(pdx, pdy) || 1;
      const los = hasLOS(d.x, d.y, g.px, g.py, g.arena.walls);

      if (d.state === 'patrol') {
        if (los && pd < 470) d.state = 'chase';
      } else if (d.state === 'chase') {
        if (!los && pd > 470) {
          d.state = 'patrol';
          newWaypoint(d);
        } else if (d.fireT <= 0 && los && pd < 620 && (!d.stunT || d.stunT <= 0)) {
          d.state = 'aim';
          d.aimT = spec.aimMs;
          d.losLost = 0;
        }
      } else if (d.state === 'aim') {
        if (!los) {
          d.losLost += dt;
          if (d.losLost > 320) { d.state = 'chase'; d.fireT = 420; }
        } else {
          d.aimT -= dt;
          if (d.aimT <= 0) {
            const tLead = (pd / spec.plasma) * (d.kind === 'gunner' ? 0.35 : 0.15);
            const ax = g.px + g.pvx * tLead;
            const ay = g.py + g.pvy * tLead;
            const ang = Math.atan2(ay - d.y, ax - d.x);
            const mx = d.x + Math.cos(ang) * (DRONE_R + 7);
            const my = d.y + Math.sin(ang) * (DRONE_R + 7);
            g.bullets.push({ x: mx, y: my, vx: Math.cos(ang) * spec.plasma, vy: Math.sin(ang) * spec.plasma, r: PLASMA_R, life: 5200, friendly: false, color: DRONE_KIND_COLORS[d.kind] });
            burst(mx, my, DRONE_KIND_COLORS[d.kind], 4, 1.4);
            d.fireT = spec.fireMs * (0.85 + Math.random() * 0.35);
            d.state = 'chase';
          }
        }
      }
      if (d.state !== 'aim') d.fireT -= dt;

      /* strafe-dodge incoming friendly bullets */
      if (spec.dodge && d.dodgeT <= 0) {
        for (const p of g.bullets) {
          if (!p.friendly) continue;
          const ddx = d.x - p.x;
          const ddy = d.y - p.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist > 170 || dist < 1) continue;
          const ux = p.vx / 7.6;
          const uy = p.vy / 7.6;
          const closing = ux * ddx + uy * ddy;
          const perp = Math.abs(ux * ddy - uy * ddx);
          if (closing > 0 && perp < 30) {
            const pa = Math.atan2(p.vy, p.vx);
            d.dodgeAng = pa + (ux * ddy - uy * ddx > 0 ? 1 : -1) * (Math.PI / 2);
            d.dodgeT = 340;
            break;
          }
        }
      }

      /* steering */
      let tx = 0;
      let ty = 0;
      let mul = 1;
      if (d.state === 'patrol') {
        const wdx = d.wp.x - d.x;
        const wdy = d.wp.y - d.y;
        const wd = Math.hypot(wdx, wdy);
        if (wd < 34) newWaypoint(d);
        else { tx = wdx / wd; ty = wdy / wd; mul = 0.6; }
      } else if (d.state === 'chase') {
        const ux = pdx / pd;
        const uy = pdy / pd;
        if (!los) {
          const side = d.orbitDir * 0.7;
          const ca = Math.cos(side);
          const sa = Math.sin(side);
          tx = ux * ca - uy * sa;
          ty = ux * sa + uy * ca;
        } else if (pd > 250) { tx = ux; ty = uy; }
        else if (pd < 170) { tx = -ux; ty = -uy; }
        else { tx = -uy * d.orbitDir; ty = ux * d.orbitDir; }
        if (Math.random() < 0.004 * step) d.orbitDir *= -1;
      } else {
        mul = 0.12;
      }
      if (d.dodgeT > 0) { tx += Math.cos(d.dodgeAng) * 1.5; ty += Math.sin(d.dodgeAng) * 1.5; }
      if (d.stunT && d.stunT > 0) { tx *= 0.1; ty *= 0.1; }

      const tm = Math.hypot(tx, ty);
      let vx = d.vx;
      let vy = d.vy;
      if (tm > 0.01) {
        const sp = spec.speed * mul;
        const ke = Math.min(1, 0.14 * step);
        vx += ((tx / tm) * sp - vx) * ke;
        vy += ((ty / tm) * sp - vy) * ke;
      } else {
        vx *= Math.pow(0.9, step);
        vy *= Math.pow(0.9, step);
      }
      let x = d.x + vx * step;
      let y = d.y + vy * step;
      const res = resolveWalls(x, y, DRONE_R, vx, vy, 0.1, g.arena.walls);
      x = res.x; y = res.y; vx = res.vx; vy = res.vy;
      const b = resolveBounds(x, y, DRONE_R, vx, vy, 0);
      d.x = b.x; d.y = b.y; d.vx = b.vx; d.vy = b.vy;

      if (Math.hypot(d.vx, d.vy) > 0.25) d.bodyAng = angLerp(d.bodyAng, Math.atan2(d.vy, d.vx), Math.min(1, 0.16 * step));
      if (los) {
        d.gunAng = angLerp(d.gunAng, Math.atan2(pdy, pdx), Math.min(1, (0.07 + 0.02) * step));
      }
    };

    const updateBoss = (d: Drone, step: number, dt: number) => {
      d.spin += 0.05 * step;
      if (d.state === 'spawn') {
        d.spawnT -= dt;
        if (d.spawnT <= 0) d.state = 'chase';
        return;
      }
      const frac = d.hp / d.maxHp;
      const newPhase = frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
      if (newPhase !== d.phase) {
        d.phase = newPhase;
        d.flashT = 300;
        g.shake = Math.max(g.shake, 0.9);
        radialBurst(d, 12, 3.6);
        sfx.bad();
      }

      const pdx = g.px - d.x;
      const pdy = g.py - d.y;
      const pd = Math.hypot(pdx, pdy) || 1;
      const want = d.phase === 3 ? 210 : 290;
      const ux = pdx / pd;
      const uy = pdy / pd;
      let mvx = 0;
      let mvy = 0;
      if (pd > want + 40) { mvx = ux; mvy = uy; }
      else if (pd < want - 40) { mvx = -ux; mvy = -uy; }
      else { mvx = -uy * d.orbitDir; mvy = ux * d.orbitDir; }
      if (Math.random() < 0.003 * step) d.orbitDir *= -1;
      const sp = (d.phase === 3 ? 1.7 : 1.25);
      d.vx += (mvx * sp - d.vx) * Math.min(1, 0.06 * step);
      d.vy += (mvy * sp - d.vy) * Math.min(1, 0.06 * step);
      const res = resolveBounds(d.x + d.vx * step, d.y + d.vy * step, BOSS_R, d.vx, d.vy, 0);
      d.x = res.x; d.y = res.y; d.vx = res.vx; d.vy = res.vy;
      d.gunAng = angLerp(d.gunAng, Math.atan2(pdy, pdx), Math.min(1, 0.05 * step));

      /* attacks */
      d.fireT -= dt;
      if (d.fireT <= 0) {
        /* aimed burst */
        d.burstN = d.phase === 1 ? 3 : 5;
        d.burstT = 0;
        d.fireT = (d.phase === 3 ? 2000 : 2800) * (0.9 + Math.random() * 0.25);
      }
      if (d.burstN && d.burstN > 0) {
        d.burstT = (d.burstT ?? 0) - dt;
        if ((d.burstT ?? 0) <= 0) {
          const tLead = pd / 4.6;
          const ang = Math.atan2(g.py + g.pvy * tLead - d.y, g.px + g.pvx * tLead - d.x);
          const off = (d.burstN % 2 === 0 ? 1 : -1) * 0.09;
          shootFrom(d, ang + off, 4.6, PLASMA_R + 1);
          d.burstN -= 1;
          d.burstT = 150;
        }
      }
      d.ringT = (d.ringT ?? 0) - dt;
      if ((d.ringT ?? 0) <= 0 && d.phase >= 2) {
        radialBurst(d, d.phase === 3 ? 14 : 10, 3.3);
        d.ringT = d.phase === 3 ? 2600 : 3400;
      }
      if (d.phase === 3) {
        d.spiralAng = (d.spiralAng ?? 0) + 0.5;
        if (Math.floor(d.spiralAng) % 2 === 0 && Math.random() < 0.09 * step) {
          shootFrom(d, d.spiralAng * 0.7, 3.9, PLASMA_R);
        }
      }
      d.minionT = (d.minionT ?? 0) - dt;
      if ((d.minionT ?? 0) <= 0) {
        const minions = g.drones.filter((x) => x.kind !== 'boss').length;
        if (minions < 3) {
          const spot = pickSpawn();
          spawnDrone('scout', spot.x, spot.y, 0);
        }
        d.minionT = 11000;
      }
    };

    const shootFrom = (d: Drone, ang: number, speed: number, r: number) => {
      const mx = d.x + Math.cos(ang) * (d.kind === 'boss' ? BOSS_R + 6 : DRONE_R + 7);
      const my = d.y + Math.sin(ang) * (d.kind === 'boss' ? BOSS_R + 6 : DRONE_R + 7);
      g.bullets.push({ x: mx, y: my, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, life: 5200, friendly: false, color: DRONE_KIND_COLORS[d.kind] });
      burst(mx, my, DRONE_KIND_COLORS[d.kind], 3, 1.3);
    };

    const radialBurst = (d: Drone, n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        shootFrom(d, (Math.PI * 2 * i) / n + Math.random() * 0.2, speed, PLASMA_R);
      }
    };

    const updateBullets = (step: number, dt: number) => {
      for (let i = g.bullets.length - 1; i >= 0; i--) {
        const p = g.bullets[i];
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.life -= dt;

        /* R12-c — drone bombs: delay-fuse arc, drag, explode on impact/fuse */
        if (p.kind === 'bomb') {
          p.vx *= Math.pow(0.972, step);
          p.vy *= Math.pow(0.972, step);
          p.x = clamp(p.x, PAD, WORLD_W - PAD);
          p.y = clamp(p.y, PAD, WORLD_H - PAD);
          if (g.gen) {
            const gw = genWall()!;
            if (circleRect(p.x, p.y, p.r, gw)) { explodeBomb(p, i); continue; }
          }
          let hitDirect = false;
          for (let j = g.drones.length - 1; j >= 0; j--) {
            const d = g.drones[j];
            if (d.state === 'spawn') continue;
            if (Math.hypot(d.x - p.x, d.y - p.y) < DRONE_R + p.r) {
              if (!p.hits?.includes(d.id)) {
                p.hits?.push(d.id);
                damageDrone(d, j, g.params.damage + 1, p.x, p.y);
              }
              hitDirect = true;
              break;
            }
          }
          if (hitDirect || p.life <= 0) explodeBomb(p, i);
          continue; // bombs arc over walls — no wall collision
        }

        if (p.life <= 0) { g.bullets.splice(i, 1); continue; }

        /* bounds + walls — shells die on impact (no ricochets in TinkTank) */
        const bb = resolveBounds(p.x, p.y, p.r, p.vx, p.vy, 0);
        p.x = bb.x; p.y = bb.y; p.vx = bb.vx; p.vy = bb.vy;
        let dead = bb.hit;
        for (const w of g.arena.walls) {
          const c = circleRect(p.x, p.y, p.r, w);
          if (!c) continue;
          p.x += c.nx * c.pen;
          p.y += c.ny * c.pen;
          dead = true;
          break;
        }
        if (dead) {
          burst(p.x, p.y, p.color, 4, 1.4);
          /* R12-c — heli rockets keep their splash when they hit a wall */
          if (p.splash && p.friendly) splashAt(p);
          g.bullets.splice(i, 1);
          continue;
        }

        if (p.friendly) {
          /* generator */
          if (g.gen) {
            const gw = genWall()!;
            if (circleRect(p.x, p.y, p.r, gw)) {
              hitGenerator(g.params.damage);
              splashAt(p);
              g.bullets.splice(i, 1);
              continue;
            }
          }
          /* drones */
          let consumed = false;
          for (let j = g.drones.length - 1; j >= 0; j--) {
            const d = g.drones[j];
            if (d.state === 'spawn') continue;
            const rad = d.kind === 'boss' ? BOSS_R : DRONE_R;
            if (Math.hypot(d.x - p.x, d.y - p.y) < rad + p.r) {
              if (p.pierce && p.hits) {
                if (p.hits.includes(d.id)) continue;
                p.hits.push(d.id);
              }
              damageDrone(d, j, g.params.damage, p.x - p.vx, p.y - p.vy);
              splashAt(p);
              /* tesla chain arc */
              if (g.params.chain && !p.molten) {
                for (let k2 = g.drones.length - 1; k2 >= 0; k2--) {
                  if (k2 === j) continue;
                  const o = g.drones[k2];
                  if (o.state === 'spawn') continue;
                  if (Math.hypot(o.x - p.x, o.y - p.y) < 150) {
                    g.beams.push({ x1: p.x, y1: p.y, x2: o.x, y2: o.y, life: 130, c: '#7dd3fc' });
                    damageDrone(o, k2, 1, p.x, p.y);
                    break;
                  }
                }
              }
              if (!p.pierce) { consumed = true; }
              break;
            }
          }
          if (consumed) { g.bullets.splice(i, 1); }
          continue;
        }

        /* enemy plasma vs player */
        if (g.invT <= 0 && g.shieldT <= 0 && Math.hypot(g.px - p.x, g.py - p.y) < PLAYER_R + p.r) {
          g.bullets.splice(i, 1);
          hitPlayer();
        }
      }
    };

    const splashAt = (p: Bullet) => {
      if (!p.splash) return;
      for (let j = g.drones.length - 1; j >= 0; j--) {
        const d = g.drones[j];
        if (d.state === 'spawn') continue;
        if (Math.hypot(d.x - p.x, d.y - p.y) < p.splash && !(p.hits && p.hits.includes(d.id))) {
          damageDrone(d, j, 1, p.x, p.y);
          if (p.hits) p.hits.push(d.id);
        }
      }
      burst(p.x, p.y, p.molten ? '#f97316' : '#fdba74', 8, 2.2);
    };

    const hitPlayer = () => {
      if (g.invT > 0 || g.phase !== 'playing') return;
      if (g.shieldHits > 0) {
        g.shieldHits -= 1;
        burst(g.px, g.py, '#38bdf8', 16, 3);
        g.invT = 700;
        g.shake = 0.5;
        sfx.bad();
        return;
      }
      if (g.shieldT > 0) return;
      g.hitsTaken += 1;
      g.hp -= 1;
      g.invT = INV_MS;
      g.hitFlash = 1;
      g.shake = perfMode ? 0 : 1;
      burst(g.px, g.py, '#f87171', 14, 2.6);
      sfx.bad();
      if (g.hp <= 0) loseMission();
    };

    const updatePickups = (step: number, dt: number) => {
      for (let i = g.pickups.length - 1; i >= 0; i--) {
        const p = g.pickups[i];
        p.t += dt;
        p.life -= dt;
        if (p.life <= 0) { g.pickups.splice(i, 1); continue; }
        if (Math.hypot(g.px - p.x, g.py - p.y) > PLAYER_R + 18) continue;
        const tt = useApp.getState().t;
        if (p.kind === 'shield') { g.shieldHits = 2; g.shieldT = 14000; pop(p.x, p.y - 14, tt('tt_pickup_shield'), '#38bdf8'); }
        else if (p.kind === 'repair') {
          if (g.hp < g.params.maxHp) { g.hp = Math.min(g.params.maxHp, g.hp + 2); pop(p.x, p.y - 14, `+♥ ${tt('tt_pickup_repair')}`, '#34d399'); }
          else { pop(p.x, p.y - 14, `+${dNum2(60)}`, '#34d399'); }
        } else {
          g.energy = Math.min(100, g.energy + 60);
          pop(p.x, p.y - 14, tt('tt_pickup_energy'), '#fbbf24');
        }
        burst(p.x, p.y, p.kind === 'shield' ? '#38bdf8' : p.kind === 'repair' ? '#34d399' : '#fbbf24', 10, 2);
        sfx.coin();
        g.pickups.splice(i, 1);
      }
    };

    const separate = () => {
      const ds = g.drones;
      for (let i = 0; i < ds.length; i++) {
        for (let j = i + 1; j < ds.length; j++) {
          const a = ds[i];
          const b = ds[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = (a.kind === 'boss' || b.kind === 'boss' ? BOSS_R : DRONE_R) + (a.kind === 'boss' || b.kind === 'boss' ? BOSS_R : DRONE_R) - 4;
          if (d < min && d > 0.01) {
            const push = (min - d) / 2;
            const nx = dx / d;
            const ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
          } else if (d <= 0.01) {
            a.x -= 1; b.x += 1;
          }
        }
        const d = ds[i];
        const dx = d.x - g.px;
        const dy = d.y - g.py;
        const dist = Math.hypot(dx, dy);
        const min = (d.kind === 'boss' ? BOSS_R : DRONE_R) + PLAYER_R;
        if (dist < min && dist > 0.01) {
          const push = (min - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          d.x += nx * push; d.y += ny * push;
          g.px -= nx * push; g.py -= ny * push;
          /* contact damage from the boss */
          if (d.kind === 'boss' && g.invT <= 0) {
            if (g.shieldT > 0) { damageDrone(d, i, 2, g.px, g.py); g.invT = 300; }
            else hitPlayer();
          }
        }
      }
    };

    /* ---------------- objective directors ---------------- */
    const directorWave = (dt: number) => {
      /* spawn queue */
      if (g.waveQueue > 0) {
        g.spawnT -= dt;
        if (g.spawnT <= 0) {
          const spot = pickSpawn();
          spawnDrone(droneKindFor(g.mission, g.wave * 3 + g.waveQueue), spot.x, spot.y, 0);
          g.waveQueue -= 1;
          g.spawnT = 380;
        }
      }
      const live = g.drones.filter((d) => d.kind !== 'boss').length;
      if (g.waveQueue === 0 && live === 0) {
        if (g.wave >= g.mission.waves) {
          winMission();
        } else {
          g.wave += 1;
          g.waveQueue = g.mission.perWave;
          g.spawnT = 500;
          setPhase('banner');
          g.phase = 'banner';
          g.bannerT = 1400;
          showBanner(`${t('tt_hud_wave')} ${dNum2(g.wave)} / ${dNum2(g.mission.waves)}`, g.wave === g.mission.waves ? t('tt_final_seconds') : t('tt_wave_incoming'));
          if (g.wave > 1) {
            sfx.win();
            pop(g.px, g.py - 30, t('tt_wave_clear'), '#fbbf24');
          }
        }
      }
    };

    const directorSurvive = (dt: number) => {
      g.surviveT -= dt;
      const frac = g.surviveT / g.mission.surviveMs;
      if (!g.halfShown && frac <= 0.5) {
        g.halfShown = true;
        showBanner(t('tt_escalate'), t('tt_half_time'), true);
        sfx.bad();
      }
      if (!g.finalShown && frac <= 0.22) {
        g.finalShown = true;
        showBanner(t('tt_escalate'), t('tt_final_seconds'), true);
        sfx.bad();
      }
      if (g.surviveT <= 0) {
        /* cascade remaining drones away */
        for (let i = g.drones.length - 1; i >= 0; i--) {
          const d = g.drones[i];
          burst(d.x, d.y, DRONE_KIND_COLORS[d.kind], 10, 2.4);
          g.drones.splice(i, 1);
        }
        winMission();
        return;
      }
      /* escalating spawns */
      g.spawnT -= dt;
      if (g.spawnT <= 0 && g.drones.length < g.mission.spawnCap) {
        const interval = 4200 * (0.4 + frac * 0.6) / (1 + (1 - frac));
        const spot = pickSpawn();
        spawnDrone(droneKindFor(g.mission, Math.floor(g.elapsed / 3000)), spot.x, spot.y, 0);
        g.spawnT = Math.max(1250, interval);
      }
    };

    const directorSiege = (dt: number) => {
      if (g.gen) {
        g.gen.spin += 0.0012 * dt;
        g.gen.flashT = Math.max(0, g.gen.flashT - dt);
        g.gen.pulseT -= dt;
        if (g.gen.pulseT <= 0) {
          g.gen.pulseT = 5200;
          for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8 + g.gen.spin;
            g.bullets.push({ x: g.gen.x + Math.cos(a) * (GEN_HALF + 8), y: g.gen.y + Math.sin(a) * (GEN_HALF + 8), vx: Math.cos(a) * 3.1, vy: Math.sin(a) * 3.1, r: PLASMA_R, life: 4600, friendly: false, color: '#f43f5e' });
          }
          sfx.timeout();
        }
      }
      /* defenders */
      const defenders = g.drones.filter((d) => d.kind !== 'boss').length;
      if (defenders < g.mission.guard) {
        g.spawnT -= dt;
        if (g.spawnT <= 0) {
          const spot = pickSpawn();
          spawnDrone(droneKindFor(g.mission, g.kills), spot.x, spot.y, 0);
          g.spawnT = g.mission.reinforceMs;
        }
      } else {
        g.spawnT = Math.min(g.spawnT, g.mission.reinforceMs);
      }
      /* chain-power-down after the generator dies */
      if (g.chainDown > 0) {
        g.chainNext -= dt;
        if (g.chainNext <= 0 && g.drones.length > 0) {
          const d = g.drones[0];
          burst(d.x, d.y, DRONE_KIND_COLORS[d.kind], 12, 2.6);
          g.drones.splice(0, 1);
          g.chainDown -= 1;
          g.chainNext = 150;
          sfx.chat();
        }
      }
    };

    const directorBoss = (_dt: number) => {
      /* boss logic lives in updateBoss; victory is scheduled on boss defeat */
    };

    /* ---------------- master update ---------------- */
    const update = (dt: number, step: number) => {
      g.time += dt;
      g.elapsed += dt;

      for (let i = g.parts.length - 1; i >= 0; i--) {
        const p = g.parts[i];
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.vx *= Math.pow(0.94, step);
        p.vy *= Math.pow(0.94, step);
        p.life -= dt;
        if (p.life <= 0) g.parts.splice(i, 1);
      }
      for (let i = g.pops.length - 1; i >= 0; i--) {
        const p = g.pops[i];
        p.y -= 0.45 * step;
        p.life -= dt;
        if (p.life <= 0) g.pops.splice(i, 1);
      }
      for (let i = g.beams.length - 1; i >= 0; i--) {
        g.beams[i].life -= dt;
        if (g.beams[i].life <= 0) g.beams.splice(i, 1);
      }
      /* R12-c — shockwave/EMP rings + fading tread decals */
      for (let i = g.booms.length - 1; i >= 0; i--) {
        g.booms[i].t += dt;
        if (g.booms[i].t >= g.booms[i].max) g.booms.splice(i, 1);
      }
      for (let i = g.decals.length - 1; i >= 0; i--) {
        g.decals[i].life -= dt;
        if (g.decals[i].life <= 0) g.decals.splice(i, 1);
      }

      if (g.phase === 'banner') {
        g.bannerT -= dt;
        if (g.bannerT <= 0) {
          g.phase = 'playing';
          setPhase('playing');
        }
        return;
      }
      if (g.phase !== 'playing') return;

      updatePlayer(step, dt);
      updateBullets(step, dt);
      for (const d of g.drones) updateDrone(d, step, dt);
      separate();

      /* camera — smooth follow */
      const tx = clamp(g.px - VIEW_W / 2, 0, WORLD_W - VIEW_W);
      const ty = clamp(g.py - VIEW_H / 2, 0, WORLD_H - VIEW_H);
      g.camX += (tx - g.camX) * Math.min(1, 0.09 * step);
      g.camY += (ty - g.camY) * Math.min(1, 0.09 * step);

      updatePickups(step, dt);

      if (g.mission.kind === 'clear') directorWave(dt);
      else if (g.mission.kind === 'survive') directorSurvive(dt);
      else if (g.mission.kind === 'siege') directorSiege(dt);
      else directorBoss(dt);
    };

    /* ============================ render ============================ */

    const drawGrid = () => {
      /* parallax far grid (screen space) */
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.save();
      ctx.translate(-g.camX * 0.35 % 80, -g.camY * 0.35 % 80);
      ctx.strokeStyle = 'rgba(148,163,184,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -80; x < VIEW_W + 160; x += 80) { ctx.moveTo(x, -160); ctx.lineTo(x, VIEW_H + 160); }
      for (let y = -160; y < VIEW_H + 160; y += 80) { ctx.moveTo(-160, y); ctx.lineTo(VIEW_W + 160, y); }
      ctx.stroke();
      ctx.restore();

      /* world transform */
      const shX = g.shake > 0 && !perfMode ? (Math.random() - 0.5) * g.shake * 10 : 0;
      const shY = g.shake > 0 && !perfMode ? (Math.random() - 0.5) * g.shake * 10 : 0;
      ctx.save();
      ctx.translate(-g.camX + shX, -g.camY + shY);

      /* near grid */
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      for (let x = PAD; x <= WORLD_W - PAD; x += 44) { ctx.moveTo(x, PAD); ctx.lineTo(x, WORLD_H - PAD); }
      for (let y = PAD; y <= WORLD_H - PAD; y += 44) { ctx.moveTo(PAD, y); ctx.lineTo(WORLD_W - PAD, y); }
      ctx.stroke();

      /* R12-c — fading tread-mark decals (ground vehicles) */
      if (g.decals.length) {
        for (const dc of g.decals) {
          ctx.save();
          ctx.translate(dc.x, dc.y);
          ctx.rotate(dc.ang);
          ctx.globalAlpha = (dc.life / dc.max) * 0.22;
          ctx.fillStyle = '#000000';
          rr(ctx, -5, -1.8, 10, 3.6, 1.4);
          ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      /* neon frame */
      ctx.save();
      ctx.shadowColor = theme.frame;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = theme.frame;
      ctx.lineWidth = 4;
      rr(ctx, PAD - 10, PAD - 10, WORLD_W - 2 * (PAD - 10), WORLD_H - 2 * (PAD - 10), 20);
      ctx.stroke();
      ctx.restore();

      /* pulsing obstacles */
      for (const w of g.arena.walls) {
        const pulse = 0.5 + 0.14 * Math.sin(g.time / 460 + w.x * 0.02 + w.y * 0.013);
        rr(ctx, w.x, w.y, w.w, w.h, 7);
        ctx.fillStyle = 'rgba(10,15,28,0.95)';
        ctx.fill();
        ctx.strokeStyle = theme.wall;
        ctx.globalAlpha = pulse + 0.3;
        ctx.lineWidth = 2;
        ctx.save();
        ctx.shadowColor = theme.wall;
        ctx.shadowBlur = 9;
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      /* pickups */
      for (const p of g.pickups) {
        const col = p.kind === 'shield' ? '#38bdf8' : p.kind === 'repair' ? '#34d399' : '#fbbf24';
        const fade = p.life < 3000 && Math.floor(p.life / 240) % 2 === 0 ? 0.35 : 1;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(p.t / 320) * 3);
        ctx.rotate(p.t / 700);
        ctx.globalAlpha = fade;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px2 = Math.cos(a) * 10;
          const py2 = Math.sin(a) * 10;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(2,6,23,0.9)';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = col;
        ctx.fillRect(-2.4, -2.4, 4.8, 4.8);
        ctx.restore();
      }

      /* generator */
      if (g.gen) {
        const gen = g.gen;
        ctx.save();
        ctx.translate(gen.x, gen.y);
        /* rotating shield ring */
        ctx.save();
        ctx.rotate(gen.spin);
        ctx.strokeStyle = 'rgba(244,63,94,0.7)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 9]);
        ctx.beginPath();
        ctx.arc(0, 0, GEN_HALF + 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        /* core */
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const px2 = Math.cos(a) * GEN_HALF;
          const py2 = Math.sin(a) * GEN_HALF;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fillStyle = gen.flashT > 0 ? '#fecdd3' : 'rgba(30,10,18,0.95)';
        ctx.save();
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 3;
        ctx.stroke();
        /* heart pulse */
        const beat = 0.6 + 0.4 * Math.sin(g.time / 240);
        ctx.fillStyle = `rgba(244,63,94,${0.4 + 0.4 * beat})`;
        ctx.beginPath();
        ctx.arc(0, 0, 13 + 4 * beat, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        /* hp bar */
        const frac = gen.hp / gen.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        rr(ctx, gen.x - 44, gen.y - GEN_HALF - 26, 88, 9, 4);
        ctx.fill();
        ctx.fillStyle = frac > 0.4 ? '#fb7185' : '#f43f5e';
        rr(ctx, gen.x - 42, gen.y - GEN_HALF - 24, 84 * Math.max(0, frac), 5, 2.5);
        ctx.fill();
      }

      /* beams (special + tesla arcs) */
      for (const b of g.beams) {
        ctx.save();
        ctx.globalAlpha = clamp(b.life / 240, 0, 1);
        ctx.strokeStyle = b.c;
        ctx.lineWidth = 5;
        ctx.shadowColor = b.c;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.restore();
      }

      /* bullets (glow) — per-class tracer styles (R12-c) */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of g.bullets) {
        if (p.kind === 'bomb') {
          /* delay-fuse bomb: shadow on the ground, body mid-arc, fuse spark */
          const prog = 1 - clamp(p.life / BOMB_FUSE, 0, 1);
          const h = Math.sin(clamp(prog, 0, 1) * Math.PI) * 17;
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 3, 4.6 * (1 - prog * 0.35), 2.4 * (1 - prog * 0.35), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          const by = p.y - h;
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, by, 4.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fbbf24';
          if (Math.floor(p.life / 90) % 2 === 0) {
            ctx.beginPath();
            ctx.arc(p.x + 3, by - 5, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          continue;
        }
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.6);
        grad.addColorStop(0, p.friendly ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)');
        grad.addColorStop(0.4, p.friendly ? `${p.color}aa` : `${p.color}88`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.friendly ? '#ffffff' : p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        /* tracer tail — style per class */
        const spd = Math.hypot(p.vx, p.vy) || 1;
        const ux = p.vx / spd;
        const uy = p.vy / spd;
        let tail = 2.2;
        if (p.kind === 'streak') tail = 4.4;       // jets: long thin rain-streak
        else if (p.kind === 'mini') tail = 1.3;    // drones: short buzz
        else if (p.kind === 'rocket') tail = 1.8;  // heli rockets + flame
        ctx.strokeStyle = p.friendly ? `${p.color}55` : `${p.color}55`;
        ctx.lineWidth = p.kind === 'streak' ? 1.6 : 2.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * tail * 0.9, p.y - p.vy * tail * 0.9);
        ctx.stroke();
        if (p.kind === 'rocket') {
          ctx.fillStyle = '#fdba74';
          ctx.beginPath();
          ctx.arc(p.x - ux * (p.r + 3), p.y - uy * (p.r + 3), 2 + Math.random() * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      /* particles */
      for (const p of g.parts) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      /* R12-c — shockwave rings / EMP pulses (drawn above particles) */
      for (const bm of g.booms) {
        const bp = clamp(bm.t / bm.max, 0, 1);
        if (bm.kind === 'emp') drawEmpPulse(ctx, bm.x, bm.y, bp, bm.r, '#7dd3fc');
        else drawShockwave(ctx, bm.x, bm.y, bp, bm.r, '#fbbf24');
      }

      /* drones */
      for (const d of g.drones) drawDrone(d);

      /* player */
      drawPlayer();

      /* score popups */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of g.pops) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.font = '900 17px ui-sans-serif, system-ui, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3.5;
        ctx.strokeText(p.txt, p.x, p.y);
        ctx.fillStyle = p.c;
        ctx.fillText(p.txt, p.x, p.y);
      }
      ctx.globalAlpha = 1;

      /* aim reticle */
      if ((g.aimMode === 'mouse' || g.aimMode === 'manual') && g.phase === 'playing') {
        ctx.save();
        ctx.translate(g.aim.x, g.aim.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.moveTo(-13, 0); ctx.lineTo(-5, 0);
        ctx.moveTo(5, 0); ctx.lineTo(13, 0);
        ctx.moveTo(0, -13); ctx.lineTo(0, -5);
        ctx.moveTo(0, 5); ctx.lineTo(0, 13);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore(); // world

      /* damage flash vignette */
      if (g.hitFlash > 0) {
        const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75);
        vg.addColorStop(0, 'rgba(244,63,94,0)');
        vg.addColorStop(1, `rgba(244,63,94,${0.4 * g.hitFlash})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }

      /* off-screen enemy hints (edge arrows) */
      if (g.phase === 'playing') {
        for (const d of g.drones) {
          if (d.state === 'spawn') continue;
          const sx = d.x - g.camX;
          const sy = d.y - g.camY;
          if (sx > 8 && sx < VIEW_W - 8 && sy > 8 && sy < VIEW_H - 8) continue;
          const ax = clamp(sx, 14, VIEW_W - 14);
          const ay = clamp(sy, 14, VIEW_H - 14);
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(Math.atan2(d.y - (g.camY + ay), d.x - (g.camX + ax)));
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = DRONE_KIND_COLORS[d.kind];
          ctx.beginPath();
          ctx.moveTo(7, 0);
          ctx.lineTo(-4, -4.5);
          ctx.lineTo(-4, 4.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    };

    const drawDrone = (d: Drone) => {
      const col = DRONE_KIND_COLORS[d.kind];
      const spawning = d.state === 'spawn';
      const prog = spawning ? clamp(1 - d.spawnT / (d.kind === 'boss' ? 1400 : 900), 0, 1) : 1;
      const rad = d.kind === 'boss' ? BOSS_R : DRONE_R;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.globalAlpha = spawning ? prog * 0.9 : 1;
      const sc = 0.4 + 0.6 * prog;
      ctx.scale(sc, sc);
      if (spawning) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = (1 - prog) * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, rad + 30 * (1 - prog) + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = prog * 0.9;
      }
      /* rotor ring */
      ctx.save();
      ctx.rotate(d.spin);
      ctx.strokeStyle = col;
      ctx.globalAlpha *= 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, rad + (d.kind === 'boss' ? 12 : 6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      /* hull */
      ctx.save();
      ctx.rotate(d.bodyAng);
      ctx.beginPath();
      if (d.kind === 'boss') {
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI / 4) * i;
          const rr2 = rad * (i % 2 === 0 ? 1 : 0.82);
          const px2 = Math.cos(a) * rr2;
          const py2 = Math.sin(a) * rr2;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px2 = Math.cos(a) * rad;
          const py2 = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(2,6,23,0.92)';
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = d.kind === 'boss' ? 20 : 10;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = col;
      ctx.lineWidth = d.kind === 'boss' ? 3 : 2;
      ctx.stroke();
      /* boss phase ring */
      if (d.kind === 'boss' && d.phase) {
        ctx.strokeStyle = d.phase === 3 ? '#fca5a5' : d.phase === 2 ? '#fb923c' : '#fda4af';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, rad - 6, 0, Math.PI * 2 * clamp(d.hp / d.maxHp, 0, 1));
        ctx.stroke();
      }
      ctx.restore();
      /* barrel + eye */
      ctx.rotate(d.gunAng);
      ctx.strokeStyle = col;
      ctx.lineWidth = d.kind === 'boss' ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(rad * 0.4, 0);
      ctx.lineTo(rad + (d.kind === 'boss' ? 16 : 7), 0);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(rad * 0.35, 0, d.kind === 'boss' ? 7 : 3.4, 0, Math.PI * 2);
      ctx.fill();
      /* aim telegraph */
      if (d.state === 'aim') {
        const prog2 = 1 - d.aimT / droneSpecLocal(d).aimMs;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(rad + 10, 0, 1.5 + prog2 * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (d.flashT > 0) {
        ctx.globalAlpha = (d.flashT / 130) * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      /* R12-c — recon radar marker on marked targets */
      if ((d.markedT ?? 0) > 0) {
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(g.time / 400);
        ctx.strokeStyle = '#2dd4bf';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.4;
        const mr = rad + 10 + Math.sin(g.time / 180) * 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -mr);
        ctx.lineTo(mr, 0);
        ctx.lineTo(0, mr);
        ctx.lineTo(-mr, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
      /* hp pips */
      if (!spawning && d.kind !== 'boss' && d.maxHp > 1) {
        for (let i = 0; i < d.maxHp; i++) {
          ctx.fillStyle = i < d.hp ? col : 'rgba(255,255,255,0.16)';
          ctx.beginPath();
          ctx.arc(d.x - (d.maxHp - 1) * 3.4 + i * 6.8, d.y - DRONE_R - 9, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawPlayer = () => {
      const blink = g.invT > 0 && Math.floor(g.time / 90) % 2 === 0;
      /* glow trail */
      if (!lowFx && g.trail.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < g.trail.length; i++) {
          const tr = g.trail[i];
          const a = (i / g.trail.length) * 0.22;
          ctx.globalAlpha = a;
          ctx.fillStyle = g.glow;
          ctx.beginPath();
          ctx.arc(tr.x, tr.y, PLAYER_R * (0.4 + 0.5 * (i / g.trail.length)), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      /* R12-c — layered upgrade-aware vehicle renderer (all classes) */
      drawVehicle({
        ctx, spec: tank, cls: g.cls, tiers,
        x: g.px, y: g.py,
        hullAng: g.hullAng, gunAng: g.gunAng,
        time: g.time, r: PLAYER_R,
        moving: Math.hypot(g.pvx, g.pvy),
        muzzle: g.muzzleT / 90,
        hpFrac: g.hp / g.params.maxHp,
        bank: g.bank,
        dashT: g.dashT > 0 ? clamp(g.dashT / DASH_MS, 0, 1) : 0,
        lowFx, alpha: blink ? 0.35 : 1,
        seed: 3,
      });
      /* special-ready aura */
      const spCost = g.params.special === 'blink' ? 40 : 100;
      if (g.energy >= spCost) {
        ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.2 * Math.sin(g.time / 180)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(g.px, g.py, PLAYER_R + 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      /* shield — hex-lattice energy pattern (R12-c) */
      if (g.shieldT > 0 || g.shieldHits > 0) {
        drawHexShield(ctx, g.px, g.py, PLAYER_R + 9, g.time, '#38bdf8', g.shieldHits);
      }
      /* heat overheat ring */
      if (g.overheated) {
        ctx.strokeStyle = 'rgba(248,113,113,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.px, g.py, PLAYER_R + 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (g.heat / HEAT_MAX));
        ctx.stroke();
      }
    };

    const drawStick = () => {
      if (!g.stick.active) return;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.stick.ox - g.camX, g.stick.oy - g.camY, 38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(244,63,94,0.45)';
      ctx.beginPath();
      ctx.arc(g.stick.ox + g.stick.dx * 30 - g.camX, g.stick.oy + g.stick.dy * 30 - g.camY, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      const scale = canvas.width / VIEW_W;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawGrid();
      drawStick();
    };

    /* ------------------------------ loop ------------------------------ */
    let raf = 0;
    let prev = performance.now();
    let lastRender = 0;
    const FRAME_MIN = lowFx ? 33 : 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { prev = now; return; }
      const dt = clamp(now - prev, 0, 34);
      if (FRAME_MIN && now - lastRender < FRAME_MIN) return;
      lastRender = now;
      prev = now;
      update(dt, dt / (1000 / 60));
      draw();
    };
    raf = requestAnimationFrame(loop);

    /* opening banner */
    {
      const tt = useApp.getState().t;
      if (mission.kind === 'boss') {
        showBanner(tt('tt_boss_warning'), `${tt('tt_kind_boss')} · ${tt('tt_level_n')} ${dNum2(mission.level)}`, true);
        sfx.bad();
        g.bannerT = 2100;
      } else if (mission.kind === 'survive') {
        showBanner(tt('tt_survive_ready'), `${tt('tt_hud_time')} ${dNum2(Math.round(mission.surviveMs / 1000))}s`);
      } else if (mission.kind === 'siege') {
        showBanner(tt('tt_objective_siege'), tt('tt_kind_siege'));
      } else {
        showBanner(`${tt('tt_hud_wave')} 1 / ${dNum2(mission.waves)}`, tt('tt_objective_clear'));
      }
      g.wave = mission.kind === 'clear' ? 0 : 1;
      if (mission.kind === 'clear') { g.waveQueue = 0; g.spawnT = 0; } // director starts wave 1
      if (mission.kind === 'boss') {
        g.bossSpawned = true;
        spawnBoss();
      }
      if (mission.kind === 'siege') g.spawnT = 800;
      if (mission.kind === 'survive') g.spawnT = 900;
    }

    /* --------------------------- keyboard ----------------------------- */
    const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { e.preventDefault(); togglePause(); return; }
      if (k === ' ') { e.preventDefault(); fireKeyRef.current = true; return; }
      if (k === 'shift') { e.preventDefault(); if (g.phase === 'playing') playerSpecial(); return; }
      /* R12-c — class controls: Q/E heli strafe · B drone bomb */
      if (k === 'q') { strafeLRef.current = true; return; }
      if (k === 'e') { strafeRRef.current = true; return; }
      if (k === 'b') { e.preventDefault(); dropBomb(); return; }
      if (MOVE_KEYS.includes(k)) { e.preventDefault(); g.keys.add(k); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ') fireKeyRef.current = false;
      else if (k === 'q') strafeLRef.current = false;
      else if (k === 'e') strafeRRef.current = false;
      else if (MOVE_KEYS.includes(k)) g.keys.delete(k);
    };
    const onWinPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') fireMouseRef.current = false;
    };
    const onVisibility = () => {
      if (document.hidden && g.phase === 'playing') { g.phase = 'paused'; setPhase('paused'); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', onWinPointerUp);
    document.addEventListener('visibilitychange', onVisibility);

    /* HUD mirror ticker */
    const hudTimer = window.setInterval(() => {
      const live = g.drones.filter((d) => d.kind !== 'boss' && d.state !== 'spawn').length + g.drones.filter((d) => d.kind !== 'boss' && d.state === 'spawn').length;
      const boss = g.drones.find((d) => d.kind === 'boss');
      setHud({
        hp: g.hp, maxHp: g.params.maxHp,
        heat: Math.round(g.heat), energy: Math.round(g.energy),
        score: liveScore(),
        wave: g.wave, waves: g.mission.waves,
        left: live,
        timeLeft: g.mission.kind === 'survive' ? Math.max(0, Math.ceil(g.surviveT / 1000)) : 0,
        bossFrac: boss ? clamp(boss.hp / boss.maxHp, 0, 1) : -1,
        genFrac: g.gen ? clamp(g.gen.hp / g.gen.maxHp, 0, 1) : -1,
        specialPct: Math.round(g.energy),
        overheated: g.overheated,
        shield: g.shieldT > 0 || g.shieldHits > 0,
      });
    }, 110);

    const liveScore = () => {
      let s = SCORE_WIN + g.mission.level * 8;
      s += g.kills * (SCORE_KILL_BASE + g.mission.level * 4);
      if (g.bossKill) s += SCORE_BOSS;
      if (g.hitsTaken === 0) s += SCORE_PERFECT;
      return Math.min(s, 2000);
    };

    const togglePause = () => {
      if (g.phase === 'playing') { g.phase = 'paused'; setPhase('paused'); sfx.click(); }
      else if (g.phase === 'paused') { g.phase = 'playing'; setPhase('playing'); sfx.click(); }
    };
    pauseRef.current = togglePause;

    /* keep counters reachable from fireBullet/damageDrone */
    (g as Game & { shots: number; hitCount: number }).shots = 0;
    (g as Game & { shots: number; hitCount: number }).hitCount = 0;

    /* patch winMission to use real accuracy counters */
    const accOf = () => {
      const sh = (g as Game & { shots: number }).shots as number;
      const hi = (g as Game & { hitCount: number }).hitCount as number;
      return sh > 0 ? Math.round((hi / sh) * 100) : 100;
    };
    accRef.current = accOf;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.clearInterval(hudTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', onWinPointerUp);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const id of timers) window.clearTimeout(id);
      gRef.current = null;
    };
  }, [runKey, screen, perfMode]);

  /* refs the engine effect needs without re-running */
  const pauseRef = useRef<() => void>(() => undefined);
  const accRef = useRef<() => number>(() => 100);

  /* --------------------- arena pointer input --------------------- */
  const toWorld = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const g = gRef.current;
    const vx = (e.clientX - r.left) * (VIEW_W / Math.max(1, r.width));
    const vy = (e.clientY - r.top) * (VIEW_H / Math.max(1, r.height));
    return { x: vx + (g?.camX ?? 0), y: vy + (g?.camY ?? 0) };
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gRef.current;
    if (!g || g.phase !== 'playing') return;
    const p = toWorld(e);
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      g.aimMode = 'mouse';
      g.aim = { x: p.x, y: p.y };
      fireMouseRef.current = true;
    } else if (p.x < g.camX + VIEW_W / 2) {
      /* double-tap → blink (mirage) */
      const now = performance.now();
      if (now - stickTapRef.current < 300 && g.params.blink && g.energy >= 40) {
        g.aim = { x: g.px + (p.x - g.px) * 2, y: g.py + (p.y - g.py) * 2 };
        playerSpecialPublic();
      }
      stickTapRef.current = now;
      g.stick = { active: true, id: e.pointerId, ox: p.x, oy: p.y, dx: 0, dy: 0 };
    } else {
      g.aimMode = 'manual';
      g.aim = { x: p.x, y: p.y };
    }
  };

  /* ---- portrait virtual joystick pad (DOM, below the arena) ---- */
  const padActiveRef = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const onPadDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gRef.current;
    if (!g || g.phase !== 'playing') return;
    const r = e.currentTarget.getBoundingClientRect();
    padActiveRef.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    g.stick = { active: true, id: e.pointerId, ox: g.px, oy: g.py, dx: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPadMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gRef.current;
    const pad = padActiveRef.current;
    if (!g || !pad || pad.id !== e.pointerId || !g.stick.active) return;
    let dx = (e.clientX - pad.cx) / (pad.cx ? 52 : 52);
    let dy = (e.clientY - pad.cy) / 52;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    g.stick.dx = dx; g.stick.dy = dy;
  };
  const onPadUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gRef.current;
    const pad = padActiveRef.current;
    if (g && pad && pad.id === e.pointerId) {
      g.stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
      padActiveRef.current = null;
    }
  };

  const playerSpecialPublic = () => {
    /* re-implementation bridge: the effect owns playerSpecial; simulate via key event */
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
  };

  const bombPublic = () => {
    /* R12-c — drone bomb button bridge (same pattern as the special button) */
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gRef.current;
    if (!g) return;
    const p = toWorld(e);
    if (e.pointerType === 'mouse') {
      if (g.aimMode !== 'manual') { g.aimMode = 'mouse'; g.aim = { x: p.x, y: p.y }; }
    } else if (g.stick.active && g.stick.id === e.pointerId) {
      let dx = (p.x - g.stick.ox) / 46;
      let dy = (p.y - g.stick.oy) / 46;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      g.stick.dx = dx;
      g.stick.dy = dy;
    } else if (g.aimMode === 'manual') {
      g.aim = { x: p.x, y: p.y };
    }
  };

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gRef.current;
    if (!g) return;
    if (e.pointerType === 'mouse') {
      fireMouseRef.current = false;
    } else if (g.stick.active && g.stick.id === e.pointerId) {
      g.stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
    }
  };

  /* ============================== HUD ============================== */

  const inGame = screen === 'game';
  const objectiveLabel =
    hud === null ? '' :
    hud.bossFrac >= 0 ? t('tt_objective_boss') :
    hud.genFrac >= 0 ? t('tt_objective_siege') : '';

  /* ============================== screens ============================== */

  if (!booted) {
    return (
      <RetroBoot
        title="TINKTANK"
        subtitle="40-LEVEL CAMPAIGN · TANK GARAGE"
        accent="#f43f5e"
        cartridgeIcon="🕹️"
        onDone={() => { setBooted(true); setScreen('menu'); }}
      />
    );
  }

  const tank = TANK_BY_ID[save.selectedTank] ?? TANKS[0];
  const starsAll = totalStars(save);
  const cls = vehicleClass(tank);
  const hudTiers = tiersOf(tank, save.upgrades);

  const headerChips = (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
        💰 {dNum(save.money)} <span className="text-amber-200/60">{t('tt_money')}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-300">
        <Rocket className="h-3 w-3" /> {t('tt_driver_lvl')} {dNum(save.driverLevel)}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-yellow-300">
        ⭐ {dNum(starsAll)}
      </span>
    </div>
  );

  const menuButton = (label: string, icon: React.ReactNode, onClick: () => void, primary = false) => (
    <Button
      className={`h-11 justify-start gap-2.5 text-sm ${primary ? 'glow-gold bg-rose-600 text-white hover:bg-rose-500' : 'bg-white/5 hover:bg-white/10'}`}
      variant={primary ? 'default' : 'outline'}
      onClick={onClick}
    >
      {icon} {label}
    </Button>
  );

  /* ---------- MENU ---------- */
  if (screen === 'menu') {
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="tt-shell mx-auto w-full max-w-lg px-3 py-6">
          <div className="animate-pop rounded-3xl border border-rose-500/25 bg-black/40 p-6 text-center shadow-2xl shadow-black/50 backdrop-blur-sm">
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl border border-rose-500/40 bg-rose-500/10 text-4xl shadow-[0_0_30px_rgba(244,63,94,0.35)]">🛡️</div>
            <h1 className="text-4xl font-black tracking-widest text-rose-400 sm:text-5xl" style={{ textShadow: '0 0 24px rgba(244,63,94,0.55), 3px 3px 0 rgba(0,0,0,0.9)' }}>TINKTANK</h1>
            <p className="mt-1 text-sm font-bold text-rose-200/70">{t('tt_menu_sub')}</p>
            <div className="mt-4 flex justify-center">{headerChips}</div>
            <div className="mt-6 grid gap-2 text-start">
              {menuButton(t('tt_menu_campaign'), <Swords className="h-4 w-4 text-rose-400" />, () => { sfx.click(); setScreen('levels'); }, true)}
              {menuButton(t('tt_menu_garage'), <Wrench className="h-4 w-4 text-sky-400" />, () => { sfx.click(); setScreen('garage'); })}
              {menuButton(t('tt_menu_howto'), <Crosshair className="h-4 w-4 text-amber-400" />, () => { sfx.click(); setScreen('howto'); })}
              {menuButton(t('tt_menu_stats'), <Trophy className="h-4 w-4 text-yellow-400" />, () => { sfx.click(); setScreen('stats'); })}
              {menuButton(t('tt_menu_exit'), <X className="h-4 w-4 text-muted-foreground" />, () => { sfx.click(); onExit(); })}
            </div>
            <p className="mt-4 text-[10px] text-muted-foreground">
              {tankName(tank, locale)} · {t('tt_special')}: {t(`tt_sp_${tank.special}` as never)}
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- LEVEL SELECT ---------- */
  if (screen === 'levels') {
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-3xl px-3 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="bg-white/5" onClick={() => { sfx.click(); setScreen('menu'); }}>
              {t('tt_back_menu')}
            </Button>
            {headerChips}
          </div>
          <div className="rounded-3xl border border-rose-500/25 bg-black/40 p-4 shadow-2xl shadow-black/50">
            <h2 className="text-lg font-black text-rose-300">⚔️ {t('tt_campaign_title')}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('tt_campaign_sub')}</p>
            <div className="nice-scroll mt-4 grid max-h-[58vh] grid-cols-4 gap-2 overflow-y-auto pe-1 sm:grid-cols-6 md:grid-cols-8">
              {Array.from({ length: 40 }, (_, i) => {
                const lv = i + 1;
                const unlocked = isLevelUnlocked(save, lv);
                const rec = save.levels[String(lv)];
                const count = missionsInLevel(lv);
                const done = rec ? rec.stars.filter((s) => s > 0).length : 0;
                const st = rec ? rec.stars.reduce((a, b) => a + b, 0) : 0;
                const boss = lv % 4 === 0;
                return (
                  <button
                    key={lv}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => { sfx.click(); setSelLevel(lv); setScreen('level'); }}
                    className={`group relative aspect-square rounded-xl border p-1 text-center transition-transform ${unlocked ? 'border-rose-500/30 bg-gradient-to-b from-rose-950/60 to-black/60 hover:-translate-y-0.5 hover:border-rose-400/60' : 'cursor-not-allowed border-white/10 bg-black/40 opacity-60'} ${boss && unlocked ? 'ring-1 ring-amber-500/50' : ''}`}
                    title={unlocked ? `${t('tt_level_n')} ${lv}` : t('tt_locked_level')}
                  >
                    <span className={`block pt-1.5 text-lg font-black ${unlocked ? 'text-rose-200' : 'text-white/30'}`}>{dNum(lv)}</span>
                    {unlocked ? (
                      <>
                        <span className="block text-[8px] leading-tight text-amber-300/90">⭐{dNum(st)}/{dNum(count * 3)}</span>
                        <span className="block text-[8px] leading-tight text-muted-foreground">{dNum(done)}/{dNum(count)}</span>
                        {boss && <span className="absolute end-1 top-1 text-[9px]">💀</span>}
                      </>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center"><Lock className="h-3.5 w-3.5 text-white/30" /></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- LEVEL DETAIL (mission list) ---------- */
  if (screen === 'level') {
    const count = missionsInLevel(selLevel);
    const rec = save.levels[String(selLevel)];
    const kinds = ['clear', 'survive', 'siege'] as const;
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-2xl px-3 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="bg-white/5" onClick={() => { sfx.click(); setScreen('levels'); }}>
              {t('tt_to_map')}
            </Button>
            {headerChips}
          </div>
          <div className="rounded-3xl border border-rose-500/25 bg-black/40 p-4 shadow-2xl shadow-black/50">
            <h2 className="text-lg font-black text-rose-300">
              {t('tt_level_title')} {dNum(selLevel)} {selLevel % 4 === 0 && <span title={t('tt_boss_level')}>💀</span>}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t('tt_missions_done')}: {dNum(rec ? rec.stars.filter((s) => s > 0).length : 0)} / {dNum(count)} · ⭐ {dNum(rec ? rec.stars.reduce((a, b) => a + b, 0) : 0)}/{dNum(count * 3)}
            </p>
            <div className="nice-scroll mt-3 max-h-[56vh] space-y-2 overflow-y-auto pe-1">
              {Array.from({ length: count }, (_, i) => {
                const kind = selLevel % 4 === 0 && i === count - 1 ? 'boss' as const : kinds[i % 3];
                const unlockedM = isMissionUnlocked(save, selLevel, i);
                const st = rec?.stars[i] ?? 0;
                const next = unlockedM && st === 0;
                const mission = buildMission(selLevel, i);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-xl border p-2.5 ${next ? 'border-rose-400/60 bg-rose-500/10' : unlockedM ? 'border-white/10 bg-white/[0.04]' : 'border-white/5 bg-black/30 opacity-55'}`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black ${kind === 'boss' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-rose-200'}`}>
                      {kind === 'boss' ? '💀' : dNum(i + 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black" style={{ color: kind === 'boss' ? '#fbbf24' : '#fda4af' }}>
                        {t(`tt_kind_${kind}` as never)} — {t(`tt_objective_${kind}` as never)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {kind === 'clear' && <>{t('tt_waves_label')}: {dNum(mission.waves)} · </>}
                        {kind === 'survive' && <>{t('tt_hud_time')}: {dNum(Math.round(mission.surviveMs / 1000))}s · </>}
                        {kind === 'boss' && <>{t('tt_boss_name')} · </>}
                        {t('tt_par_time')}: {dNum(Math.round(mission.parMs / 1000))}s
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] tracking-tight text-amber-300">
                      {'★'.repeat(st)}<span className="text-white/15">{'★'.repeat(3 - st)}</span>
                    </span>
                    {unlockedM && (
                      <Button size="sm" className={`shrink-0 ${next ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-white/10'}`} onClick={() => deploy(selLevel, i)}>
                        <Play className="me-1 h-3.5 w-3.5" /> {next ? t('tt_start_mission') : t('tt_replay_mission')}
                      </Button>
                    )}
                    {!unlockedM && <Lock className="h-4 w-4 shrink-0 text-white/25" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- BRIEFING ---------- */
  if (screen === 'brief') {
    const count = missionsInLevel(selLevel);
    const kind = selLevel % 4 === 0 && selMission === count - 1 ? 'boss' as const : (['clear', 'survive', 'siege'] as const)[selMission % 3];
    const mission = buildMission(selLevel, selMission);
    const p = computeParams(tank, save.upgrades);
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-lg px-3 py-4">
          <div className="animate-pop rounded-3xl border border-rose-500/25 bg-black/40 p-5 shadow-2xl shadow-black/50">
            <p className="text-[10px] uppercase tracking-widest text-rose-300/70">{t('tt_brief_title')}</p>
            <h2 className="mt-1 text-xl font-black text-rose-300">
              {t('tt_level_title')} {dNum(selLevel)} · {t('tt_mission' as never)} {dNum(selMission + 1)} — {t(`tt_kind_${kind}` as never)}
            </h2>
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="text-sm font-bold text-rose-100">🎯 {t(`tt_objective_${kind}` as never)}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-rose-200/80">
                {kind === 'clear' && <span>⚔️ {t('tt_waves_label')}: <b>{dNum(mission.waves)}</b></span>}
                {kind === 'survive' && <span>⏱ {t('tt_hud_time')}: <b>{dNum(Math.round(mission.surviveMs / 1000))}s</b></span>}
                {kind === 'siege' && <span>🏗 {t('tt_generator_label')} HP: <b>{dNum(mission.genHp)}</b></span>}
                {kind === 'boss' && <span>💀 {t('tt_boss_name')} · {dNum(mission.bossPhases)} phases</span>}
                <span>🤖 {t('tt_enemy_intel')}: HP {dNum(mission.droneHp)}+</span>
                <span>⏱ {t('tt_par_time')}: <b>{dNum(Math.round(mission.parMs / 1000))}s</b></span>
              </div>
              {/* R12-c — advisory recommended-class hint (never a requirement) */}
              <div className="mt-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black"
                  style={{ borderColor: `${CLASS_META[mission.recClass].color}66`, background: `${CLASS_META[mission.recClass].color}18`, color: CLASS_META[mission.recClass].color }}
                >
                  🧭 {t('tt_recommended')}: {t(`tt_rec_${mission.recClass}` as never)}
                </span>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-lg text-lg" style={{ background: `${tank.color}22`, color: tank.glow }}>🛡️</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black" style={{ color: tank.glow }}>{tankName(tank, locale)}</p>
                  <p className="text-[10px] text-muted-foreground">{t('tt_selected_tank')} — <button className="underline decoration-dotted" onClick={() => { sfx.click(); setScreen('garage'); }}>{t('tt_change_in_garage')}</button></p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1.5 text-center text-[9px] text-muted-foreground">
                {TANK_STATS.map((s) => (
                  <div key={s}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${(effStat(tank, s, save.upgrades) / 10) * 100}%`, background: tank.glow }} />
                    </div>
                    <span className="mt-0.5 block">{t(`tt_stat_${s}` as never)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-sky-300/90">⚡ {t(`tt_sp_${tank.special}` as never)} — HP {dNum(p.maxHp)}</p>
              <p className="mt-1 text-[10px] text-white/60">🎮 {t(`tt_ctrl_${cls}` as never)}</p>
            </div>
            <div className="mt-4 flex gap-2">
              <Button className="glow-gold flex-1 bg-rose-600 text-white hover:bg-rose-500" onClick={() => deploy(selLevel, selMission)}>
                <Rocket className="me-1.5 h-4 w-4" /> {t('tt_deploy')}
              </Button>
              <Button variant="outline" onClick={() => { sfx.click(); setScreen('level'); }}>
                {t('tt_to_map')}
              </Button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- GARAGE (R12-c: class tabs + live hangar previews + upgrade diagrams) ---------- */
  if (screen === 'garage') {
    const tabs: { key: VehicleClass | 'all'; label: string; icon: string }[] = [
      { key: 'all', label: t('tt_tab_all'), icon: '🔧' },
      { key: 'tank', label: t('tt_class_tank'), icon: '🛡️' },
      { key: 'heli', label: t('tt_class_heli'), icon: '🚁' },
      { key: 'drone', label: t('tt_class_drone'), icon: '🛸' },
      { key: 'jet', label: t('tt_class_jet'), icon: '✈️' },
    ];
    const roster = garTab === 'all' ? FLEET : FLEET.filter((v) => vehicleClass(v) === garTab);
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-4xl px-3 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="bg-white/5" onClick={() => { sfx.click(); setScreen('menu'); }}>
              {t('tt_back_menu')}
            </Button>
            {headerChips}
          </div>
          <div className="rounded-3xl border border-sky-500/25 bg-black/40 p-4 shadow-2xl shadow-black/50">
            <h2 className="text-lg font-black text-sky-300">🔧 {t('tt_garage_title')}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('tt_garage_sub')}</p>
            {/* class tabs — TANKS / HELIS / DRONES / AIR */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tabs.map((tb) => {
                const n = tb.key === 'all' ? FLEET.length : FLEET.filter((v) => vehicleClass(v) === tb.key).length;
                const active = garTab === tb.key;
                const c = tb.key === 'all' ? '#38bdf8' : CLASS_META[tb.key].color;
                return (
                  <button
                    key={tb.key}
                    type="button"
                    onClick={() => { sfx.click(); setGarTab(tb.key); }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition-colors ${active ? 'text-black' : 'text-white/70 hover:text-white'}`}
                    style={active ? { background: c, borderColor: c } : { borderColor: `${c}55`, background: `${c}12` }}
                  >
                    <span aria-hidden>{tb.icon}</span> {tb.label}
                    <span className={active ? 'opacity-70' : 'opacity-50'}>{dNum(n)}</span>
                  </button>
                );
              })}
            </div>
            <div className="nice-scroll mt-4 grid max-h-[62vh] gap-3 overflow-y-auto pe-1 lg:grid-cols-2">
              {roster.map((tk) => (
                <VehicleCard
                  key={tk.id}
                  tk={tk}
                  save={save}
                  selected={save.selectedTank === tk.id}
                  dNum={dNum}
                  t={t}
                  locale={locale}
                  onBuy={buyTank}
                  onSelect={selectTank}
                  onUpgrade={upgradeStat}
                />
              ))}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- HOW TO ---------- */
  if (screen === 'howto') {
    const rows = [t('tt_how1'), t('tt_how2'), t('tt_how3'), t('tt_how4'), t('tt_how5'), t('tt_how6'), t('tt_how7')];
    const icons = ['🛡️', '🖱️', '📱', '⚔️', '⭐', '🔧', '🚁'];
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-lg px-3 py-4">
          <div className="rounded-3xl border border-amber-500/25 bg-black/40 p-5 shadow-2xl shadow-black/50">
            <h2 className="text-lg font-black text-amber-300">📖 {t('tt_howto_title')}</h2>
            <div className="mt-3 space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                  <span className="mt-0.5 shrink-0">{icons[i]}</span>
                  <p className="text-[11.5px] leading-relaxed text-foreground/90">{r}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-[10px] text-muted-foreground">
              <span className="hidden sm:inline">{t('tt_keys_hint')}</span>
              <span className="sm:hidden">{t('tt_touch_hint')}</span>
            </p>
            <Button className="mt-4 w-full" onClick={() => { sfx.click(); setScreen('menu'); }}>{t('tt_back_menu')}</Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- STATS ---------- */
  if (screen === 'stats') {
    const levelsDone = Object.values(save.levels).filter((r) => r.cleared).length;
    const stats: [string, number][] = [
      [t('tt_levels_done'), levelsDone],
      [t('tt_stat_missions'), save.stats.missions],
      [t('tt_stat_kills'), save.stats.kills],
      [t('tt_stat_boss'), save.stats.bossKills],
      [t('tt_stat_perfect'), save.stats.perfect],
      [t('tt_stat_deaths'), save.stats.deaths],
      [t('tt_stat_best'), save.stats.bestScore],
      [t('tt_stars_total'), starsAll],
    ];
    const need = driverNeed(save.driverLevel);
    return (
      <Shell rtl={rtl} onExit={onExit}>
        <div className="mx-auto w-full max-w-lg px-3 py-4">
          <div className="rounded-3xl border border-yellow-500/25 bg-black/40 p-5 shadow-2xl shadow-black/50">
            <h2 className="text-lg font-black text-yellow-300">🏆 {t('tt_stats_title')}</h2>
            <div className="mt-2 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-sky-200">
                <span>{t('tt_driver_lvl')} {dNum(save.driverLevel)}</span>
                <span>{dNum(save.driverXp)} / {dNum(need)} ✦</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300" style={{ width: `${(save.driverXp / need) * 100}%` }} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {stats.map(([label, v]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-center">
                  <p className="text-lg font-black text-amber-300">{dNum(v)}</p>
                  <p className="text-[9px] leading-tight text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <Button className="mt-4 w-full" onClick={() => { sfx.click(); setScreen('menu'); }}>{t('tt_back_menu')}</Button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---------- GAME ---------- */
  const mission = buildMission(selLevel, selMission);
  const count = missionsInLevel(selLevel);
  const kind = selLevel % 4 === 0 && selMission === count - 1 ? 'boss' as const : (['clear', 'survive', 'siege'] as const)[selMission % 3];

  return (
    <Shell rtl={rtl} onExit={onExit}>
      <div className="tt-shell mx-auto flex min-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col px-2 pb-2 pt-2 sm:px-3">
        {/* HUD */}
        <div className="relative z-10 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="flex items-center gap-1.5 text-sm font-black text-rose-100">
            <Crosshair className="h-4 w-4 shrink-0 text-rose-400" />
            {t('game_mazemind')}
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-200">
            {t('tt_level_n')} {dNum(selLevel)}-{dNum(selMission + 1)} · {t(`tt_kind_${kind}` as never)}
          </span>
          {/* R12-c — vehicle silhouette mini-icon + class badge */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold"
            style={{ borderColor: `${CLASS_META[cls].color}55`, background: `${CLASS_META[cls].color}14`, color: CLASS_META[cls].color }}
          >
            <VehicleMiniIcon spec={tank} tiers={hudTiers} size={18} />
            {t(`tt_class_${cls}` as never)}
          </span>
          {hud && kind === 'clear' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/80">
              {t('tt_hud_wave')} {dNum(hud.wave)}/{dNum(hud.waves)} · 🤖 {dNum(hud.left)} {t('tt_hud_left')}
            </span>
          )}
          {hud && kind === 'survive' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-200">
              <Timer className="h-3 w-3" /> {dNum(hud.timeLeft)}s
            </span>
          )}
          {hud && kind === 'siege' && hud.genFrac >= 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-200">
              🏗 {dNum(Math.ceil(hud.genFrac * 100))}%
            </span>
          )}
          {hud && hud.shield && (
            <span className="tt-pulse inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-300">
              <Shield className="h-3 w-3" />
            </span>
          )}
          <span className="ms-auto flex items-center gap-2">
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-rose-200 hover:bg-white/10 hover:text-rose-100"
              aria-label={t('tt_paused')} title={t('tt_paused')}
              onClick={() => pauseRef.current()}
            >
              <Pause className="h-4 w-4" />
            </Button>
            <span className="text-end">
              <span className="block text-[9px] uppercase tracking-wide text-rose-200/60">{t('score')}</span>
              <span className="gold-text block text-xl font-black leading-none sm:text-2xl">{dNum(hud?.score ?? 0)}</span>
            </span>
          </span>
        </div>

        {/* boss hp bar */}
        {hud && hud.bossFrac >= 0 && (
          <div className="relative z-10 mb-1.5">
            <div className="flex items-center justify-between text-[10px] font-black text-rose-300">
              <span>💀 {t('tt_boss_name')}</span><span>{dNum(Math.ceil(hud.bossFrac * 100))}%</span>
            </div>
            <div className="mt-0.5 h-2.5 overflow-hidden rounded-full border border-rose-500/40 bg-black/60">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all" style={{ width: `${hud.bossFrac * 100}%` }} />
            </div>
          </div>
        )}

        {/* arena */}
        <div
          className="relative mx-auto w-full touch-none select-none"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, width: portrait ? 'min(100%, calc(46dvh * 1.6667))' : undefined }}
          role="application"
          aria-label={`${t('game_mazemind')} — ${t('game_mazemind_desc')}`}
        >
          <canvas
            key={`${runKey}`}
            ref={canvasRef}
            className="absolute inset-0 h-full w-full rounded-2xl border border-rose-500/30 bg-[#070b14]"
            style={{ touchAction: 'none' }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* touch action buttons */}
          {hasTouch && phase === 'playing' && (
            <>
              <button
                type="button"
                aria-label={t('tt_fire')}
                className="absolute bottom-3 end-3 z-20 grid h-[68px] w-[68px] touch-none select-none place-items-center rounded-full border-2 border-rose-400/70 bg-rose-500/20 text-rose-100 shadow-lg shadow-black/50 backdrop-blur-sm active:bg-rose-500/50"
                onPointerDown={(e) => { e.preventDefault(); fireBtnRef.current = true; }}
                onPointerUp={() => { fireBtnRef.current = false; }}
                onPointerCancel={() => { fireBtnRef.current = false; }}
                onPointerLeave={() => { fireBtnRef.current = false; }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Zap className="h-8 w-8" fill="currentColor" />
              </button>
              <button
                type="button"
                aria-label={t('tt_special_btn')}
                className={`absolute bottom-[104px] end-5 z-20 grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 text-xs font-black shadow-lg shadow-black/50 backdrop-blur-sm active:scale-95 ${hud && hud.specialPct >= (gRef.current?.params.blink ? 40 : 100) ? 'border-amber-300/80 bg-amber-500/25 text-amber-100' : 'border-white/20 bg-black/50 text-white/40'}`}
                onPointerDown={(e) => { e.preventDefault(); playerSpecialPublic(); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <span className="leading-none">{hud ? dNum(hud.specialPct) : '0'}</span>
                <span className="text-[7px] uppercase">{cls === 'jet' ? t('tt_dash') : t('tt_special_btn')}</span>
              </button>
              {/* R12-c — class action buttons (only when the class needs them, ≥56px) */}
              {cls === 'heli' && (
                <div className="absolute bottom-3 end-[92px] z-20 flex flex-col gap-2">
                  <button
                    type="button"
                    aria-label={`${t('tt_strafe')} ◀`}
                    className="grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-lg shadow-black/50 backdrop-blur-sm active:bg-emerald-500/45"
                    onPointerDown={(e) => { e.preventDefault(); strafeLRef.current = true; }}
                    onPointerUp={() => { strafeLRef.current = false; }}
                    onPointerCancel={() => { strafeLRef.current = false; }}
                    onPointerLeave={() => { strafeLRef.current = false; }}
                    onContextMenu={(e) => e.preventDefault()}
                  >◀</button>
                  <button
                    type="button"
                    aria-label={`${t('tt_strafe')} ▶`}
                    className="grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-lg shadow-black/50 backdrop-blur-sm active:bg-emerald-500/45"
                    onPointerDown={(e) => { e.preventDefault(); strafeRRef.current = true; }}
                    onPointerUp={() => { strafeRRef.current = false; }}
                    onPointerCancel={() => { strafeRRef.current = false; }}
                    onPointerLeave={() => { strafeRRef.current = false; }}
                    onContextMenu={(e) => e.preventDefault()}
                  >▶</button>
                </div>
              )}
              {cls === 'drone' && (
                <button
                  type="button"
                  aria-label={t('tt_bomb')}
                  className="absolute bottom-3 end-[92px] z-20 grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-amber-400/60 bg-amber-500/15 text-[9px] font-black leading-tight text-amber-100 shadow-lg shadow-black/50 backdrop-blur-sm active:bg-amber-500/45"
                  onPointerDown={(e) => { e.preventDefault(); bombPublic(); }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  💥<span className="text-[7px] uppercase">{t('tt_bomb')}</span>
                </button>
              )}
              {gRef.current?.params.blink && (
                <p className="absolute bottom-1 start-3 z-20 rounded bg-black/50 px-1.5 py-0.5 text-[8px] text-white/60">{t('tt_special_blink_hint')}</p>
              )}
            </>
          )}

          {/* portrait touch deck lives OUTSIDE the arena (see below) */}

          {/* banner */}
          {banner && phase === 'banner' && (
            <div key={banner.key} className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
              <div className="tt-banner text-center">
                <div className={`text-3xl font-black drop-shadow-[0_0_18px_rgba(244,63,94,0.6)] sm:text-4xl ${banner.danger ? 'text-rose-400' : 'gold-text'}`}>{banner.text}</div>
                {banner.sub && <div className="mt-1 text-sm font-bold text-rose-200/80">{banner.sub}</div>}
              </div>
            </div>
          )}

          {/* overheated hint */}
          {hud?.overheated && phase === 'playing' && (
            <div className="pointer-events-none absolute start-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-rose-500/40 bg-black/70 px-3 py-1 text-[11px] font-black text-rose-300">
              🔥 {t('tt_overheated')}
            </div>
          )}

          {/* bars overlay: hull / heat / energy */}
          {hud && (
            <div className="pointer-events-none absolute bottom-2 start-2 z-10 w-40 space-y-1 sm:w-52">
              <Bar label={t('tt_hud_hull')} value={hud.hp} max={hud.maxHp} color="#34d399" heart />
              <Bar label={t('tt_hud_heat')} value={hud.heat} max={100} color={hud.overheated ? '#f87171' : '#fbbf24'} />
              <Bar label={t('tt_hud_energy')} value={hud.specialPct} max={100} color="#38bdf8" />
            </div>
          )}

          {/* pause overlay */}
          {phase === 'paused' && (
            <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-black/70 backdrop-blur-sm">
              <div className="animate-pop w-full max-w-[280px] space-y-3 rounded-2xl border border-rose-500/25 bg-[#0a0f1e]/95 p-5 text-center">
                <Pause className="mx-auto h-8 w-8 text-rose-400" />
                <p className="text-lg font-black text-rose-100">{t('tt_paused')}</p>
                <div className="grid gap-2">
                  <Button className="glow-gold" onClick={() => pauseRef.current()}>
                    <Play className="me-1 h-4 w-4" /> {t('tt_resume')}
                  </Button>
                  <Button variant="outline" onClick={retry}>{t('tt_restart')}</Button>
                  <Button variant="outline" onClick={toLevelMap}>{t('tt_quit_map')}</Button>
                </div>
              </div>
            </div>
          )}

          {/* mission result panel */}
          {result && phase === 'won' && (
            <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto rounded-2xl bg-black/75 p-3 backdrop-blur-sm">
              <div className="animate-pop w-full max-w-[340px] space-y-3 rounded-2xl border border-emerald-500/30 bg-[#0a0f1e]/95 p-5 text-center">
                <p className="text-3xl">🎖️</p>
                <h3 className="gold-text text-xl font-black">{t('tt_mission_complete')}</h3>
                <StarsRow stars={result.r.stars} labels={[t('tt_star_clear'), t('tt_star_clean'), t('tt_star_fast')]} dNum={dNum} />
                <div className="flex items-center justify-center gap-2 text-sm font-bold">
                  <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-400">+{dNum(result.money)} 💰 {t('tt_money')}</span>
                  <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-400">+{dNum(result.xp)} ✦</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {result.firstClear ? t('tt_first_clear') : t('tt_replay_reward')}
                  {result.newStars > 0 && <> · ⭐×{dNum(result.newStars)} {t('tt_star_bonus')}</>}
                </p>
                {result.rewards && (
                  <p className="text-[11px] font-bold text-amber-300">
                    {t('tt_platform_rewards')}: +{dNum(result.rewards.coins)} 🪙 · +{dNum(result.rewards.xp)} ✦
                  </p>
                )}
                {!result.rewards && !useApp.getState().user && <p className="text-[10px] text-muted-foreground">{t('tt_guest_local')}</p>}
                <div className="grid gap-2 pt-1">
                  {selMission + 1 < count ? (
                    <Button className="glow-gold bg-rose-600 text-white hover:bg-rose-500" onClick={() => deploy(selLevel, selMission + 1)}>
                      {t('tt_next_mission')} <Play className="ms-1 h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={retry}>{t('tt_retry')}</Button>
                  <Button variant="outline" onClick={toLevelMap}>{t('tt_to_map')}</Button>
                </div>
              </div>
            </div>
          )}

          {/* mission failed panel */}
          {result && phase === 'lost' && (
            <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-black/75 p-3 backdrop-blur-sm">
              <div className="animate-pop w-full max-w-[300px] space-y-3 rounded-2xl border border-rose-500/30 bg-[#0a0f1e]/95 p-5 text-center">
                <p className="text-3xl">💥</p>
                <h3 className="text-xl font-black text-rose-300">{t('tt_mission_failed')}</h3>
                <p className="text-[11px] text-muted-foreground">🤖 {dNum(result.r.kills)} · ⏱ {dNum(Math.round(result.r.timeMs / 1000))}s</p>
                <div className="grid gap-2 pt-1">
                  <Button className="glow-gold bg-rose-600 text-white hover:bg-rose-500" onClick={retry}>{t('tt_retry')}</Button>
                  <Button variant="outline" onClick={toLevelMap}>{t('tt_to_map')}</Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* portrait touch control deck — big thumb-friendly pads under the arena */}
        {portrait && phase === 'playing' && (
          <div className="mx-auto mt-auto flex w-full max-w-[420px] select-none items-end justify-between gap-3 px-3 pb-1 pt-3" style={{ touchAction: 'none' }}>
            <div
              role="application"
              aria-label={t('tt_move')}
              className="relative grid h-[104px] w-[104px] touch-none place-items-center rounded-full border-2 border-white/15 bg-white/5 text-white/50 shadow-lg shadow-black/40"
              onPointerDown={onPadDown}
              onPointerMove={onPadMove}
              onPointerUp={onPadUp}
              onPointerCancel={onPadUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="h-11 w-11 rounded-full border border-white/20 bg-white/10" />
              <span className="absolute bottom-1 text-[8px] font-bold tracking-widest">{t('tt_move')}</span>
            </div>
            <div className="flex items-end gap-2">
              {/* R12-c — class action column (heli strafe / drone bomb) */}
              {(cls === 'heli' || cls === 'drone') && (
                <div className="flex flex-col gap-2">
                  {cls === 'heli' ? (
                    <>
                      <button
                        type="button"
                        aria-label={`${t('tt_strafe')} ◀`}
                        className="grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-lg shadow-black/50 active:bg-emerald-500/45"
                        onPointerDown={(e) => { e.preventDefault(); strafeLRef.current = true; }}
                        onPointerUp={() => { strafeLRef.current = false; }}
                        onPointerCancel={() => { strafeLRef.current = false; }}
                        onPointerLeave={() => { strafeLRef.current = false; }}
                        onContextMenu={(e) => e.preventDefault()}
                      >◀</button>
                      <button
                        type="button"
                        aria-label={`${t('tt_strafe')} ▶`}
                        className="grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-lg shadow-black/50 active:bg-emerald-500/45"
                        onPointerDown={(e) => { e.preventDefault(); strafeRRef.current = true; }}
                        onPointerUp={() => { strafeRRef.current = false; }}
                        onPointerCancel={() => { strafeRRef.current = false; }}
                        onPointerLeave={() => { strafeRRef.current = false; }}
                        onContextMenu={(e) => e.preventDefault()}
                      >▶</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('tt_bomb')}
                      className="grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 border-amber-400/60 bg-amber-500/15 text-sm font-black text-amber-100 shadow-lg shadow-black/50 active:bg-amber-500/45"
                      onPointerDown={(e) => { e.preventDefault(); bombPublic(); }}
                      onContextMenu={(e) => e.preventDefault()}
                    >💥</button>
                  )}
                </div>
              )}
              <button
                type="button"
                aria-label={t('tt_special_btn')}
                className={`grid h-14 w-14 touch-none select-none place-items-center rounded-full border-2 text-[10px] font-black shadow-lg shadow-black/50 active:scale-95 ${hud && hud.specialPct >= (gRef.current?.params.blink ? 40 : 100) ? 'border-amber-300/80 bg-amber-500/25 text-amber-100' : 'border-white/20 bg-black/50 text-white/40'}`}
                onPointerDown={(e) => { e.preventDefault(); playerSpecialPublic(); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {hud ? dNum(hud.specialPct) : '۰'}
              </button>
              <button
                type="button"
                aria-label={t('tt_fire')}
                className="grid h-[76px] w-[76px] touch-none select-none place-items-center rounded-full border-2 border-rose-400/70 bg-rose-500/25 text-rose-100 shadow-lg shadow-black/50 active:bg-rose-500/60"
                onPointerDown={(e) => { e.preventDefault(); fireBtnRef.current = true; }}
                onPointerUp={() => { fireBtnRef.current = false; }}
                onPointerCancel={() => { fireBtnRef.current = false; }}
                onPointerLeave={() => { fireBtnRef.current = false; }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Zap className="h-9 w-9" fill="currentColor" />
              </button>
            </div>
          </div>
        )}

        {/* control hint */}
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          <span className="hidden sm:inline">{t('tt_keys_hint')}</span>
          <span className="sm:hidden">{t('tt_touch_hint')}</span>
        </p>
      </div>

      {/* shared royal modal on LEVEL completion */}
      <ArcadeResultModal
        open={!!levelModal}
        title={`🏆 ${t('tt_level_complete')} — ${t('tt_level_n')} ${dNum(selLevel)}`}
        subtitle={levelModal ? `⭐ ${dNum(levelModal.stars)}/${dNum(levelModal.starsMax)} · +${dNum(levelModal.money)} 💰 ${t('tt_money')}${save.driverLevel < (saveRef.current.driverLevel) ? '' : ''}` : undefined}
        score={levelModal?.score ?? 0}
        rewards={levelModal?.rewards ?? null}
        emoji="🛡️"
        onAgain={() => {
          const next = selLevel < 40 ? selLevel + 1 : selLevel;
          setLevelModal(null);
          setSelLevel(next);
          setScreen(next === selLevel + 1 ? 'level' : 'levels');
          sfx.click();
        }}
        onExit={() => { setLevelModal(null); toLevelMap(); }}
      />
    </Shell>
  );
}

/* ============================== subcomponents ============================== */

function Shell({ children, rtl, onExit }: { children: React.ReactNode; rtl: boolean; onExit: () => void }) {
  void onExit;
  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="relative z-10">
      <style>{TT_CSS}</style>
      {children}
    </div>
  );
}

function Bar({ label, value, max, color, heart }: { label: string; value: number; max: number; color: string; heart?: boolean }) {
  const pct = clamp((value / Math.max(1, max)) * 100, 0, 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-11 shrink-0 text-end text-[8px] font-bold text-white/60">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full border border-white/15 bg-black/60">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      {heart ? <Heart className="h-2.5 w-2.5 text-emerald-400" fill="currentColor" /> : null}
    </div>
  );
}

function StarsRow({ stars, labels, dNum }: { stars: number; labels: string[]; dNum: (n: number) => string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <Star
            key={i}
            className={`h-8 w-8 ${i < stars ? 'animate-pop text-amber-400' : 'text-white/15'}`}
            fill="currentColor"
            style={i < stars ? { animationDelay: `${i * 180}ms` } : undefined}
          />
        ))}
      </div>
      <div className="space-y-0.5 text-[9.5px] text-muted-foreground">
        {labels.map((l, i) => (
          <p key={i} className={i < stars ? 'text-amber-300/80' : ''}>
            {i < stars ? '★' : '☆'} {l} {i === 2 && stars < 3 ? `(${tStatic('tt_hud_time')})` : ''}
            {i === 2 ? '' : ''}
          </p>
        ))}
      </div>
      <span className="hidden">{dNum(0)}</span>
    </div>
  );
}

/* ====================== R12-c vehicle canvas components ====================== */

const CLASS_META: Record<VehicleClass, { label: string; color: string; icon: string }> = {
  tank: { label: 'TANK', color: '#f43f5e', icon: '🛡️' },
  heli: { label: 'HELI', color: '#34d399', icon: '🚁' },
  drone: { label: 'DRONE', color: '#fbbf24', icon: '🛸' },
  jet: { label: 'AIR', color: '#22d3ee', icon: '✈️' },
};

/* one shared RAF loop drives every animated garage preview */
const previewTickers = new Set<(t: number) => void>();
let previewRaf = 0;
let previewStart = 0;
function ensurePreviewLoop(): void {
  if (previewRaf) return;
  previewStart = performance.now();
  const step = (now: number) => {
    previewRaf = requestAnimationFrame(step);
    if (document.hidden) return;
    const t = now - previewStart;
    previewTickers.forEach((fn) => fn(t));
  };
  previewRaf = requestAnimationFrame(step);
}
function stopPreviewLoopIfIdle(): void {
  if (previewTickers.size === 0 && previewRaf) {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
  }
}

/** HUD mini-icon — flat silhouette of the CURRENT vehicle + upgrade state. */
export function VehicleMiniIcon({ spec, tiers, size = 18 }: { spec: TankSpec; tiers: UpgradeTiers; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawVehicle({
      ctx, spec, cls: vehicleClass(spec), tiers,
      x: size / 2, y: size / 2,
      hullAng: -Math.PI / 2, gunAng: -Math.PI / 2,
      time: 1200, r: size * 0.26, moving: 0, muzzle: 0, hpFrac: 1,
      silhouette: true, seed: 5,
    });
  }, [spec, tiers, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />;
}

/** Garage card preview — the layered renderer on a lit hangar pad, idle-animated. */
function VehiclePreview({ spec, tiers, selected }: { spec: TankSpec; tiers: UpgradeTiers; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const w = 96;
  const h = 84;
  const perfMode = useApp((s) => s.perfMode);
  const tierKey = `${tiers.power},${tiers.rate},${tiers.speed},${tiers.armor},${tiers.energy}`;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const cls = vehicleClass(spec);
    const paint = (tt: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawHangarPreview(ctx, spec, cls, tiers, w, h, tt, selected);
    };
    paint(900);
    if (perfMode) return; // static frame in performance mode
    const fn = (tt: number) => paint(tt);
    previewTickers.add(fn);
    ensurePreviewLoop();
    return () => { previewTickers.delete(fn); stopPreviewLoopIfIdle(); };
  }, [spec, tierKey, selected, perfMode]);
  return (
    <canvas
      ref={ref}
      style={{ width: w, height: h, borderColor: `${spec.color}55` }}
      className="shrink-0 rounded-xl border bg-black/60"
      aria-hidden
    />
  );
}

/** Stat-row micro-diagram — before→after silhouettes for the NEXT tier. */
function StatDiagram({ tk, stat, tier }: { tk: TankSpec; stat: TTStat; tier: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const w = 54;
  const h = 22;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (tier >= 5) return; // fully upgraded — nothing left to grow
    const from: UpgradeTiers = { power: 0, rate: 0, speed: 0, armor: 0, energy: 0 };
    from[stat] = tier;
    const to: UpgradeTiers = { ...from, [stat]: tier + 1 };
    drawUpgradeDiagram(ctx, tk, vehicleClass(tk), from, to, w, h, 900);
  }, [tk, stat, tier]);
  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ width: w, height: h }}
      className="shrink-0 rounded bg-black/40"
      aria-hidden
    />
  );
}

/** One garage card: animated preview + class badge + tier slider + stat rows. */
function VehicleCard({ tk, save, selected, dNum, t, locale, onBuy, onSelect, onUpgrade }: {
  tk: TankSpec;
  save: TTSave;
  selected: boolean;
  dNum: (n: number | string) => string;
  t: (k: string) => string;
  locale: Locale;
  onBuy: (v: TankSpec) => void;
  onSelect: (v: TankSpec) => void;
  onUpgrade: (v: TankSpec, s: TTStat) => void;
}) {
  const cls = vehicleClass(tk);
  const meta = CLASS_META[cls];
  const owned = save.ownedTanks.includes(tk.id);
  const levelOk = save.driverLevel >= tk.reqLevel;
  const affordable = save.money >= tk.price;
  const realTiers = tiersOf(tk, save.upgrades);
  /* -1 = follow the vehicle's real upgrade state; 0…5 = uniform preview tier */
  const [previewTier, setPreviewTier] = useState(-1);
  const shownTiers: UpgradeTiers = previewTier < 0
    ? realTiers
    : { power: previewTier, rate: previewTier, speed: previewTier, armor: previewTier, energy: previewTier };
  const avgTier = Math.round((realTiers.power + realTiers.rate + realTiers.speed + realTiers.armor + realTiers.energy) / 5);
  const sliderVal = previewTier < 0 ? avgTier : previewTier;

  return (
    <div className={`relative rounded-2xl border p-3 transition-colors ${selected ? 'border-amber-400/60 bg-amber-500/5' : owned ? 'border-white/15 bg-white/[0.03]' : 'border-white/10 bg-black/40'}`}>
      {selected && <span className="absolute -top-2 end-3 z-10 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-black text-black">{t('tt_selected')}</span>}
      <div className="flex items-start gap-3">
        <VehiclePreview spec={tk} tiers={shownTiers} selected={selected} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[8.5px] font-black"
              style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
            >
              {meta.icon} {meta.label}
            </span>
            <p className="truncate text-sm font-black" style={{ color: tk.glow }}>{tankName(tk, locale)}</p>
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{tankBlurb(tk, locale)}</p>
          <p className="mt-1 text-[10px] font-bold" style={{ color: meta.color }}>⚡ {t(`tt_sp_${tk.special}` as never)}</p>
          <p className="text-[9.5px] text-muted-foreground">{t(`tt_passive_${passiveKey(tk)}` as never)}</p>
          {/* upgrade-state slider — animates the vehicle through tiers 0→5 */}
          {owned && (
            <label className="mt-1.5 flex items-center gap-2 text-[9px] text-muted-foreground">
              <span className="shrink-0">{t('tt_preview_tier')}</span>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={sliderVal}
                onChange={(e) => setPreviewTier(Number(e.target.value))}
                className="h-1 flex-1 accent-emerald-400"
                aria-label={t('tt_preview_tier')}
              />
              <b className="w-3 text-end" style={{ color: tk.glow }}>{dNum(sliderVal)}</b>
            </label>
          )}
        </div>
      </div>
      {/* stat rows with before→after micro-diagrams */}
      <div className="mt-2.5 space-y-1.5">
        {TANK_STATS.map((s) => {
          const tier = save.upgrades[`${tk.id}:${s}`] ?? 0;
          const eff = effStat(tk, s, save.upgrades);
          const cost = upgradeCost(tk, tier);
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="w-11 shrink-0 text-[9px] font-bold text-muted-foreground">{t(`tt_stat_${s}` as never)}</span>
              <StatDiagram tk={tk} stat={s} tier={tier} />
              <div className="h-2 min-w-8 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-all" style={{ width: `${(eff / 10) * 100}%`, background: `linear-gradient(90deg, ${tk.color}, ${tk.glow})` }} />
              </div>
              <span className="w-6 text-end text-[9px] font-black" style={{ color: tk.glow }}>{dNum(Math.round(eff * 10) / 10)}</span>
              {owned ? (
                tier < 5 ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
                    disabled={save.money < cost}
                    title={`${t('tt_upgrade')} +${dNum(cost)} 💰`}
                    onClick={() => onUpgrade(tk, s)}
                  >
                    ↑{dNum(cost)}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-black text-white/50">{t('tt_maxed')}</span>
                )
              ) : (
                <span className="w-9 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
      {/* action row */}
      <div className="mt-2.5 flex items-center gap-2">
        {!owned && (
          <>
            <span className="text-[11px] font-black text-amber-300">💰 {dNum(tk.price)}</span>
            {!levelOk && <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">{t('tt_need_driver')} {dNum(tk.reqLevel)}</span>}
            <Button
              size="sm"
              className="ms-auto bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={!levelOk || !affordable}
              onClick={() => onBuy(tk)}
            >
              {t('tt_buy')}
            </Button>
          </>
        )}
        {owned && !selected && (
          <Button size="sm" variant="outline" className="ms-auto bg-white/5" onClick={() => onSelect(tk)}>
            {t('tt_select')}
          </Button>
        )}
        {owned && selected && <span className="ms-auto text-[10px] font-bold text-amber-300">✓ {t('tt_selected')}</span>}
      </div>
    </div>
  );
}

/* ============================== styling ============================== */

const TT_CSS = `
.tt-shell{background:
  radial-gradient(110% 80% at 50% -10%, rgba(244,63,94,.10), transparent 55%),
  radial-gradient(130% 110% at 50% 115%, rgba(56,189,248,.08), transparent 60%),
  linear-gradient(180deg,#0a0f1e 0%,#070b16 55%,#050810 100%);}
.tt-banner{animation:tt-banner 1.5s cubic-bezier(.2,1.3,.4,1) both;}
@keyframes tt-banner{0%{opacity:0;transform:scale(.55)}18%{opacity:1;transform:scale(1.08)}30%{transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:scale(1.05)}}
.tt-pulse{animation:tt-pulse 1.6s ease-in-out infinite;}
@keyframes tt-pulse{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.tt-banner{animation:tt-fade .4s ease both}.tt-pulse{animation:none}}
@keyframes tt-fade{from{opacity:0}to{opacity:1}}
`;

/* client-only default (SSR-safe) */
function defaultClientSave(): TTSave {
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

/* static t() bridge for subcomponents outside hooks (label only) */
function tStatic(key: string): string {
  try { return useApp.getState().t(key as never) || key; } catch { return key; }
}
