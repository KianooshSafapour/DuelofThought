'use client';

/**
 * CheesyPursuitGame — "CHEESY PURSUIT" (فار و پنیر) — task R12-a.
 *
 * A labyrinth cat-and-mouse chase inspired by the 2000 classic, rebuilt as a
 * modern arcade campaign:
 *  · 30 deterministic levels (procedural recursive-backtracker mazes with
 *    loop-carving for tactical flanking — see src/lib/game/cheese-data.ts).
 *  · PLAY AS MOUSE (collect all cheese → escape burrow) or AS CAT (lead the
 *    pack and catch the AI mouse before it empties the maze). DOG mode swaps
 *    the hunters to fast-straight / bad-cornering dogs.
 *  · THE COLLECTIVE AI: a central PackBrain with five gated tiers —
 *    Wander → Pursuit (shared last-seen) → Interception (A* to predicted
 *    position, separation steering, burrow cutoff) → Pack Tactics (role
 *    assignment: CHASER / INTERCEPTOR at BFS-betweenness chokepoints /
 *    FLANKER on the loop route) → Hunting Net (escape-route denial that
 *    shrinks the mouse's reachable region + staggered burst speeds).
 *    Reaction delay scales 300ms → 80ms with the tier.
 *  · Cartoon canvas art: expressive eyes, whisker twitch, squash & stretch,
 *    sine-wave tails, panic faces, cheese crumbs + sparkles, burrow pull-in,
 *    warm lamp lighting + vignette, hand-hatched themed walls, confetti.
 *
 * Platform integration: RetroBoot → useGameSession() → submitArcade('cheese')
 * + announceArcadeRewards → progress in localStorage doi_cheese_v1 →
 * Character Shop backed by the platform store (/api/store, char_* items).
 * perfMode: DPR capped at 1, particles halved, decorations skipped.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import { useApp } from '@/store/app';
import { localizeDigits } from '@/lib/i18n';
import { sfx } from '@/lib/sound';
import { useGameSession, isTouchDevice } from '@/lib/immersive';
import { submitArcade, announceArcadeRewards, type ArcadeSubmitResult } from '@/lib/arcade-client';
import { Button } from '@/components/ui/button';
import { RetroBoot } from '@/components/shared/RetroBoot';
import { api } from '@/lib/api';
import { CelebrationSprite } from '@/components/shared/CelebrationSprite';
import { Cat, ChevronLeft, CakeSlice as Cheese, Clock, Flame, Heart, Lock, Mouse, Pause, Play, PawPrint, ShoppingBag, Star, Timer, Trophy, X, Zap } from 'lucide-react';
import {
  mulberry32, clamp,
  buildLevel, solveLayout, bfsDist, astarPath, chokepoints,
  TIER_TABLE, THEME_PALETTES,
  CHARACTERS, CHAR_BY_CODE, FREE_MOUSE, FREE_CAT,
  isLevelUnlocked, starsTotal,
  loadCPSave, saveCPSave, defaultCPSave,
  charName,
  type LevelDef, type LevelLayout, type Maze, type MazeTheme,
  type Species, type CharDef, type Perk, type HatKind, type CharPalette,
  type CRole, type CMode, type CPSave,
} from '@/lib/game/cheese-data';

/* ============================== tuning ================================= */

const CELL = 46;            // logical px per maze cell
const ACTOR_R = 0.31;       // actor radius in cells
const CATCH_DIST = 0.58;    // catch / pickup radius in cells
const EAT_DIST = 0.52;
const GRACE_MS = 1300;      // hunters can't catch right after spawn/level start
const SPAWN_FADE = 700;     // hunter spawn fade-in (uncatchable)
const SPRINT_MUL = 1.42;
const SPRINT_DRAIN = 26;    // stamina / s
const SPRINT_REGEN = 13;    // stamina / s
const DOG_STRAIGHT = 1.2;   // dog straight-line speed multiplier
const DOG_ACCEL = 7.5;      // lower accel → worse cornering (cat accel 11)
const CAT_ACCEL = 11;
const COMBO_WINDOW = 4200;

/* ================================ types ================================ */

type Phase = 'banner' | 'playing' | 'paused' | 'won' | 'lost';
type Screen = 'boot' | 'menu' | 'levels' | 'shop' | 'howto' | 'brief' | 'game';
type Role = 'wander' | 'chase' | 'intercept' | 'flank' | 'guard' | 'leader';
type Mood = 'calm' | 'panic' | 'chew' | 'pounce' | 'happy';

interface Actor {
  id: number;
  species: Species;
  pal: CharPalette;
  hat: HatKind;
  hatColor: string;
  x: number; y: number;       // cell-space (cell c center = c + 0.5)
  vx: number; vy: number;
  ang: number;                // facing
  speed: number;              // cells/s
  accel: number;              // cornering
  path: { c: number; r: number }[];
  role: Role;
  walkT: number;
  mood: Mood;
  moodT: number;
  blinkT: number;
  spawnT: number;             // >0 = materializing
  repathT: number;
  burstUntil: number;
  burstMul: number;
  stuckT: number;             // ms spent failing to move (unstick logic)
  fx: number;                 // generic anim clock
}

interface CheeseCell { c: number; r: number; taken: boolean; sparkT: number }

interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number; spin: number; conf?: boolean }
interface Pop { x: number; y: number; txt: string; c: string; life: number; max: number }

interface HudMirror {
  cheese: number; cheeseTotal: number; timeLeft: number; stamina: number;
  score: number; danger: boolean; tier: number; hunters: number; open: boolean;
}

/** Live game state constructed in startLevel and consumed by step/render. */
interface Game {
  phase: 'banner' | 'playing' | 'paused' | 'won' | 'lost';
  def: LevelDef;
  lay: LevelLayout;
  role: CRole;
  mode: CMode;
  dogMode: boolean;
  mouse: Actor;
  player: Actor | null;      // cat-role leader (null in mouse role)
  hunters: Actor[];
  cheese: CheeseCell[];
  collected: number;
  burrowOpen: boolean;
  winT: number;
  timeLeft: number;
  stamina: number;
  staminaMax: number;
  sprinting: boolean;
  score: number;
  combo: number;
  comboT: number;
  shake: number;
  flash: number;
  time: number;
  parts: Part[];
  pops: Pop[];
  keys: Set<string>;
  stick: { active: boolean; dx: number; dy: number; id: number };
  brain: PackBrain;
  mouseBrain: MouseBrain | null;
  spawnQueue: number;
  spawnedCount: number;
  nextSpawnAt: number;
  graceT: number;
  bannerT: number;
  lowFx: boolean;
  senseBonus: number;
}

interface RunResult {
  won: boolean;
  reason: 'caught' | 'time' | 'escaped' | 'escape';
  score: number;
  stars: number;
  timeMs: number;
  cheese: number;
}

/* ============================ math helpers ============================= */

function circleHitsWall(m: Maze, x: number, y: number, r: number): boolean {
  const c0 = Math.floor(x - r);
  const c1 = Math.floor(x + r);
  const r0 = Math.floor(y - r);
  const r1 = Math.floor(y + r);
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      if (cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows) return true;
      if (m.grid[rr * m.cols + cc] !== 1) continue;
      // circle vs cell AABB
      const nx = clamp(x, cc, cc + 1);
      const ny = clamp(y, rr, rr + 1);
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/** Chebyshev-free BFS step distance between two cells via a precomputed map. */
const distAt = (map: Int32Array, m: Maze, c: number, r: number): number =>
  c < 0 || r < 0 || c >= m.cols || r >= m.rows ? -1 : map[r * m.cols + c];

function nearestFloor(m: Maze, x: number, y: number): { c: number; r: number } {
  let c = clamp(Math.floor(x), 0, m.cols - 1);
  let r = clamp(Math.floor(y), 0, m.rows - 1);
  if (m.grid[r * m.cols + c] === 0) return { c, r };
  for (let rad = 1; rad < Math.max(m.cols, m.rows); rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows) continue;
        if (m.grid[rr * m.cols + cc] === 0) return { c: cc, r: rr };
      }
    }
  }
  return { c, r };
}

/* ============================ PackBrain ================================ */
/**
 * The collective hunters' brain. ONE instance per run — every cat/dog reads
 * the same blackboard, so the pack behaves like a coordinated unit whose
 * cleverness is gated by the level's tier (1…5).
 */
class PackBrain {
  tier: 1 | 2 | 3 | 4 | 5;
  maze: Maze;
  spec: typeof TIER_TABLE[1];
  /* shared blackboard */
  lastSeen: { x: number; y: number; t: number } | null = null;
  private pending: { x: number; y: number; at: number } | null = null;
  predicted: { x: number; y: number } | null = null;
  private roles = new Map<number, Role>();
  private targets = new Map<number, { c: number; r: number }>();
  private choke: { c: number; r: number; score: number }[] = [];
  private lastAssign = -99999;
  private burstSeq = 0;
  private lastBurst = -99999;
  private mouseVel = { x: 0, y: 0 };

  constructor(maze: Maze, tier: 1 | 2 | 3 | 4 | 5) {
    this.maze = maze;
    this.tier = tier;
    this.spec = TIER_TABLE[tier];
  }

  /** Report a visual sighting (called by any hunter with LOS). */
  report(x: number, y: number, now: number, mouseVel: { x: number; y: number }): void {
    this.mouseVel = mouseVel;
    if (!this.pending || Math.hypot(this.pending.x - x, this.pending.y - y) > 0.9) {
      this.pending = { x, y, at: now + this.spec.reactionMs };
    }
  }

  refreshBlackboard(now: number): void {
    if (this.pending && now >= this.pending.at) {
      this.lastSeen = { x: this.pending.x, y: this.pending.y, t: now };
      this.pending = null;
    }
    if (this.lastSeen && now - this.lastSeen.t > 3200) this.lastSeen = null;
    /* prediction horizon (T3+) */
    if (this.tier >= 3 && this.lastSeen) {
      const px = this.lastSeen.x + this.mouseVel.x * this.spec.predictS;
      const py = this.lastSeen.y + this.mouseVel.y * this.spec.predictS;
      const cell = nearestFloor(this.maze, px, py);
      this.predicted = { x: cell.c + 0.5, y: cell.r + 0.5 };
    } else {
      this.predicted = null;
    }
  }

  /** Rebuild chokepoint list when the objective set changes. */
  rebuildChoke(cheese: CheeseCell[], burrow: { c: number; r: number }, mouseCell: { c: number; r: number }): void {
    const interest = [burrow, mouseCell, ...cheese.filter((q) => !q.taken).map((q) => ({ c: q.c, r: q.r }))];
    this.choke = chokepoints(this.maze, interest).slice(0, 10);
  }

  /**
   * Utility-based role assignment. Runs on its own cadence (assignMs) and
   * whenever the pack size changed. Returns true when roles were refreshed.
   */
  assign(hunters: Actor[], burrow: { c: number; r: number }, cheese: CheeseCell[], now: number, pathLen: (a: Actor, c: number, r: number) => number): boolean {
    if (hunters.length === 0) return false;
    const due = now - this.lastAssign >= this.spec.assignMs;
    const unknown = hunters.some((h) => !this.roles.has(h.id));
    if (!due && !unknown) return false;
    this.lastAssign = now;

    const anchor = this.predicted ?? (this.lastSeen ? { x: this.lastSeen.x, y: this.lastSeen.y } : null);
    const anchorCell = anchor ? nearestFloor(this.maze, anchor.x, anchor.y) : null;

    /* ---- T1: everyone wanders independently ---- */
    if (this.tier === 1) {
      for (const h of hunters) {
        this.roles.set(h.id, 'wander');
        this.targets.set(h.id, randomFloorCell(this.maze));
      }
      return true;
    }

    /* ---- rank hunters by travel distance to the anchor ---- */
    const ranked = [...hunters].sort((a, b) =>
      (anchorCell ? pathLen(a, anchorCell.c, anchorCell.r) : 0) - (anchorCell ? pathLen(b, anchorCell.c, anchorCell.r) : 0));

    const openChoke = this.choke.filter((q) => !cheese.every((ch) => ch.taken) || true);
    let chokeIdx = 0;
    const used = new Set<string>();

    const takeChokeNear = (pref?: { c: number; r: number }): { c: number; r: number } | null => {
      const pool = openChoke.filter((q) => !used.has(`${q.c},${q.r}`));
      if (pool.length === 0) return null;
      let best = pool[0];
      if (pref) {
        let bd = Infinity;
        for (const q of pool) {
          const d = Math.abs(q.c - pref.c) + Math.abs(q.r - pref.r);
          if (d < bd) { bd = d; best = q; }
        }
      } else if (chokeIdx < pool.length) {
        best = pool[chokeIdx];
      }
      used.add(`${best.c},${best.r}`);
      chokeIdx++;
      return { c: best.c, r: best.r };
    };

    for (const [i, h] of ranked.entries()) {
      if (this.tier <= 2) {
        /* T2: shared last-seen broadcast */
        this.roles.set(h.id, anchorCell ? 'chase' : 'wander');
        this.targets.set(h.id, anchorCell ?? randomFloorCell(this.maze));
        continue;
      }
      if (this.tier === 3) {
        if (i === ranked.length - 1) {
          /* last cat cuts off the burrow */
          this.roles.set(h.id, 'guard');
          this.targets.set(h.id, { c: burrow.c, r: burrow.r });
        } else {
          this.roles.set(h.id, anchorCell ? 'chase' : 'wander');
          this.targets.set(h.id, anchorCell ?? randomFloorCell(this.maze));
        }
        continue;
      }
      /* T4 / T5 pack tactics */
      const chasers = this.tier >= 4 ? (ranked.length >= 4 ? 2 : 1) : 1;
      if (i < chasers) {
        this.roles.set(h.id, 'chase');
        this.targets.set(h.id, anchorCell ?? { c: burrow.c, r: burrow.r });
      } else if (i === chasers && ranked.length >= 3) {
        /* flanker: aim past the anchor (the executor routes it via loops) */
        this.roles.set(h.id, 'flank');
        this.targets.set(h.id, anchorCell ?? { c: burrow.c, r: burrow.r });
      } else {
        this.roles.set(h.id, 'intercept');
        const remaining = cheese.filter((q) => !q.taken);
        const pref = remaining.length > 0
          ? remaining.reduce((a, b) => (pathLen(h, a.c, a.r) <= pathLen(h, b.c, b.r) ? a : b))
          : burrow;
        const cell = takeChokeNear(pref) ?? takeChokeNear() ?? { c: pref.c, r: pref.r };
        /* T5 escape-route denial: prefer the guard cell that squeezes the
         * mouse's reachable region the most (top-3 candidates only). */
        if (this.tier === 5 && anchorCell) {
          let bestCell = cell;
          let bestRegion = Infinity;
          for (const cand of [cell, ...openChoke.filter((q) => !used.has(`${q.c},${q.r}`)).slice(0, 2)]) {
            const region = this.regionSize(anchorCell, cand);
            if (region < bestRegion) { bestRegion = region; bestCell = cand; }
          }
          used.add(`${bestCell.c},${bestCell.r}`);
          this.targets.set(h.id, bestCell);
          continue;
        }
        this.targets.set(h.id, cell);
      }
    }

    /* T5 staggered bursts: rotate a fresh speed burst so one hunter is
     * always angling ahead of the mouse. */
    if (this.tier === 5 && now - this.lastBurst >= 2100) {
      this.lastBurst = now;
      const h = ranked[this.burstSeq % ranked.length];
      h.burstUntil = now + 1500;
      h.burstMul = 1.32;
      this.burstSeq++;
    }
    return true;
  }

  roleOf(id: number): Role { return this.roles.get(id) ?? 'wander'; }
  targetOf(id: number): { c: number; r: number } | null { return this.targets.get(id) ?? null; }
  seenFresh(now: number): boolean { return !!this.lastSeen && now - this.lastSeen.t < 2600; }

  /** Mouse reachable-region size with an optional cell blocked (T5 denial). */
  private regionSize(from: { c: number; r: number }, blocked: { c: number; r: number }): number {
    const { cols: C, rows: R, grid } = this.maze;
    const seen = new Uint8Array(C * R);
    const q: number[] = [from.r * C + from.c];
    seen[from.r * C + from.c] = 1;
    let n = 0;
    while (q.length > 0) {
      const cur = q.pop() as number;
      n++;
      const c = cur % C;
      const r = (cur - c) / C;
      const nb = [cur - 1, cur + 1, cur - C, cur + C];
      const ok = [c > 0 && grid[cur - 1] === 0, c < C - 1 && grid[cur + 1] === 0, r > 0 && grid[cur - C] === 0, r < R - 1 && grid[cur + C] === 0];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const idx = nb[k];
        if (seen[idx]) continue;
        if (blocked && idx === blocked.r * C + blocked.c) continue;
        seen[idx] = 1;
        q.push(idx);
      }
    }
    return n;
  }
}

function randomFloorCell(m: Maze): { c: number; r: number } {
  for (let i = 0; i < 200; i++) {
    const c = 1 + Math.floor(Math.random() * (m.cols - 2));
    const r = 1 + Math.floor(Math.random() * (m.rows - 2));
    if (m.grid[r * m.cols + c] === 0) return { c, r };
  }
  return { c: 1, r: 1 };
}

/* ========================= AI mouse (cat role) ========================= */
/**
 * Same tier system inverted: the mouse plans cheese routes, then when the
 * pack closes in it flees via A* toward the safest frontier cell, penalizes
 * dead-ends, and (tier ≥ 3) fakes through maze loops to break line of sight.
 */
class MouseBrain {
  tier: 1 | 2 | 3 | 4 | 5;
  maze: Maze;
  private fleeT = 0;
  private fake = false;

  constructor(maze: Maze, tier: 1 | 2 | 3 | 4 | 5) {
    this.maze = maze;
    this.tier = tier;
  }

  /** Decide the mouse's target cell. */
  plan(
    mouse: Actor,
    hunters: Actor[],
    cheese: CheeseCell[],
    burrow: { c: number; r: number },
    now: number,
  ): { c: number; r: number } {
    const m = this.maze;
    const mc = Math.floor(mouse.x);
    const mr = Math.floor(mouse.y);

    /* threat check: nearest hunter distance (in steps) */
    let nearestSteps = Infinity;
    for (const h of hunters) {
      const d = Math.hypot(h.x - mouse.x, h.y - mouse.y);
      if (d < 3.2) nearestSteps = Math.min(nearestSteps, d);
    }
    const panicking = nearestSteps < 3.2;

    if (!panicking) {
      /* route to nearest remaining cheese, then the burrow */
      const remaining = cheese.filter((q) => !q.taken);
      const goal = remaining.length > 0
        ? remaining.reduce((a, b) => {
            const da = astarPath(m, mc, mr, a.c, a.r).length;
            const db = astarPath(m, mc, mr, b.c, b.r).length;
            return da <= db ? a : b;
          })
        : burrow;
      return { c: goal.c, r: goal.r };
    }

    /* ---- flee: sample frontier, score by hunter-distance ---- */
    if (now - this.fleeT < 240) {
      const t = this.targets ?? { c: mc, r: mr };
      return t;
    }
    this.fleeT = now;
    const dist = bfsDist(m, mc, mr);
    /* hunter proximity map (min over hunters, euclid in cells) */
    const hunterAt = (c: number, r: number): number => {
      let mn = Infinity;
      for (const h of hunters) mn = Math.min(mn, Math.hypot(h.x - (c + 0.5), h.y - (r + 0.5)));
      return mn;
    };
    const openN = (c: number, r: number): number => {
      let n = 0;
      if (!this.wallAt(c - 1, r)) n++;
      if (!this.wallAt(c + 1, r)) n++;
      if (!this.wallAt(c, r - 1)) n++;
      if (!this.wallAt(c, r + 1)) n++;
      return n;
    };
    const scored: { c: number; r: number; s: number }[] = [];
    for (let r = 1; r < m.rows - 1; r++) {
      for (let c = 1; c < m.cols - 1; c++) {
        const d = dist[r * m.cols + c];
        if (d < 0 || d > 9) continue;
        let s = hunterAt(c, r) * 2.2 - d * 0.55;
        if (openN(c, r) <= 1) s -= 7;                 // dead-end: breathe there and die
        s += Math.hypot(burrow.c - c, burrow.r - r) * -0.08;
        if (this.tier >= 3) s += (Math.sin(c * 13.7 + r * 7.1) + 1) * 0.35; // wiggle = less predictable
        scored.push({ c, r, s });
      }
    }
    scored.sort((a, b) => b.s - a.s);
    if (scored.length === 0) return { c: mc, r: mr };
    /* tier ≥ 3: sometimes take the second-best route (fake through loops) */
    this.fake = this.tier >= 3 && Math.random() < 0.28;
    const pick = this.fake && scored.length > 2 ? scored[1 + Math.floor(Math.random() * 2)] : scored[0];
    this.targets = { c: pick.c, r: pick.r };
    return this.targets;
  }

  private wallAt(c: number, r: number): boolean {
    return c < 0 || r < 0 || c >= this.maze.cols || r >= this.maze.rows || this.maze.grid[r * this.maze.cols + c] === 1;
  }

  private targets: { c: number; r: number } | null = null;
}

/* ============================== cartoon art ============================ */

interface DrawOpts {
  pal: CharPalette;
  hat: HatKind;
  hatColor: string;
  walkT: number;
  tailT: number;
  mood: Mood;
  blink: boolean;
  sprint?: boolean;
  hue?: number;   // subtle per-hunter variation 0..1
}

function drawHat(ctx: CanvasRenderingContext2D, hat: HatKind, color: string, r: number): void {
  ctx.save();
  switch (hat) {
    case 'goggles': {
      ctx.strokeStyle = '#3b4252';
      ctx.lineWidth = r * 0.14;
      ctx.beginPath();
      ctx.moveTo(-r * 0.72, -r * 0.28);
      ctx.lineTo(r * 0.72, -r * 0.28);
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.34, -r * 0.3, r * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(190,225,255,0.85)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = r * 0.1;
        ctx.stroke();
      }
      break;
    }
    case 'glasses': {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.09;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.26, -r * 0.08, r * 0.22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, -r * 0.08);
      ctx.lineTo(r * 0.05, -r * 0.08);
      ctx.stroke();
      break;
    }
    case 'band': {
      ctx.fillStyle = color;
      ctx.fillRect(-r * 0.75, -r * 0.62, r * 1.5, r * 0.28);
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.55);
      ctx.lineTo(r * 1.15, -r * 0.7);
      ctx.lineTo(r * 1.0, -r * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bow': {
      ctx.fillStyle = color;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.78);
        ctx.lineTo(s * r * 0.55, -r * 1.05);
        ctx.lineTo(s * r * 0.5, -r * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, -r * 0.78, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tricorn': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, -r * 0.45);
      ctx.quadraticCurveTo(0, -r * 1.5, r * 0.85, -r * 0.45);
      ctx.quadraticCurveTo(0, -r * 0.8, -r * 0.85, -r * 0.45);
      ctx.fill();
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(0, -r * 0.72, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'scarf': {
      ctx.fillStyle = color;
      ctx.fillRect(-r * 0.6, r * 0.12, r * 1.2, r * 0.26);
      ctx.beginPath();
      ctx.moveTo(r * 0.3, r * 0.3);
      ctx.lineTo(r * 0.75, r * 0.85);
      ctx.lineTo(r * 0.25, r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'hood': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -r * 0.18, r * 0.88, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(r * 0.4, -r * 0.1);
      ctx.quadraticCurveTo(0, -r * 0.5, -r * 0.4, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tiara': {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.5);
      ctx.lineTo(-r * 0.2, -r * 0.85);
      ctx.lineTo(0, -r * 0.55);
      ctx.lineTo(r * 0.2, -r * 0.85);
      ctx.lineTo(r * 0.4, -r * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(0, -r * 0.9, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'antenna': {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(r * 0.12, -r * 1.15);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(r * 0.14, -r * 1.22, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(r * 0.1, -r * 1.26, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'collar': {
      ctx.fillStyle = color;
      ctx.fillRect(-r * 0.55, r * 0.05, r * 1.1, r * 0.22);
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(0, r * 0.16, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'badge': {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * r * 0.2, r * 0.05 + Math.sin(a) * r * 0.2);
        ctx.lineTo(Math.cos(a2) * r * 0.09, r * 0.05 + Math.sin(a2) * r * 0.09);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cap': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -r * 0.42, r * 0.55, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-r * 0.1, -r * 0.48, r * 0.85, r * 0.12);
      break;
    }
    case 'none':
    default:
      break;
  }
  ctx.restore();
}

/** Eyes with tracking pupils; moods change the mouth + extras. */
function drawFace(
  ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, face: number,
  lookX: number, lookY: number, o: DrawOpts, species: Species,
): void {
  const panic = o.mood === 'panic';
  const pounce = o.mood === 'pounce';
  const eyeR = r * (species === 'mouse' ? 0.34 : 0.26);
  const blinkK = o.blink ? 0.12 : 1;
  for (const s of [-1, 1]) {
    const ex = hx + s * r * 0.3;
    ctx.save();
    ctx.translate(ex, hy - r * 0.12);
    ctx.scale(1, blinkK);
    ctx.beginPath();
    ctx.ellipse(0, 0, eyeR, eyeR * (panic ? 1.15 : 1), 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,25,0.55)';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    /* pupil */
    const px = clamp(lookX, -1, 1) * eyeR * 0.42;
    const py = clamp(lookY, -1, 1) * eyeR * 0.42;
    ctx.beginPath();
    if (species === 'cat' && !panic) {
      ctx.ellipse(px, py, eyeR * 0.16, eyeR * 0.42, 0, 0, Math.PI * 2); // vertical pupils
    } else {
      ctx.arc(px, py, eyeR * (panic ? 0.2 : 0.3), 0, Math.PI * 2);
    }
    ctx.fillStyle = '#241d18';
    ctx.fill();
    ctx.restore();
  }
  /* brows for pounce */
  if (pounce) {
    ctx.strokeStyle = 'rgba(40,30,25,0.7)';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.5, hy - r * 0.5);
    ctx.lineTo(hx - r * 0.12, hy - r * 0.38);
    ctx.moveTo(hx + r * 0.5, hy - r * 0.5);
    ctx.lineTo(hx + r * 0.12, hy - r * 0.38);
    ctx.stroke();
  }
  /* mouth */
  ctx.strokeStyle = '#241d18';
  ctx.lineWidth = r * 0.07;
  const my = hy + r * 0.32;
  if (panic || o.mood === 'chew') {
    ctx.beginPath();
    if (panic) { ctx.ellipse(hx + face * r * 0.32, my, r * 0.16, r * 0.22, 0, 0, Math.PI * 2); ctx.fillStyle = '#7c2d2d'; ctx.fill(); }
    else { /* chewing grin */
      ctx.beginPath();
      ctx.arc(hx + face * r * 0.32, my - r * 0.05, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(hx + face * r * 0.3, my - r * 0.14, r * 0.2, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  /* sweat drops when panicking */
  if (panic) {
    ctx.fillStyle = 'rgba(125,211,252,0.9)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hx + s * r * 0.95, hy - r * 0.55 + Math.sin(o.tailT * 6 + s) * r * 0.06, r * 0.09, r * 0.15, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMouse(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: DrawOpts): void {
  const walk = Math.sin(o.walkT * Math.PI * 2);
  const face = o.hue !== undefined && o.hue < 0 ? -1 : 1; // mirror handled via hue sign
  const bob = walk * r * 0.05;
  const sy = 1 + walk * 0.05;
  const sx = 1 - walk * 0.05;

  /* tail — sine wave */
  ctx.strokeStyle = o.pal.accent;
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - face * r * 0.85, y + r * 0.15);
  const t = o.tailT * Math.PI * 2;
  ctx.bezierCurveTo(
    x - face * r * 1.5, y + r * 0.1 + Math.sin(t) * r * 0.3,
    x - face * r * 2.0, y - r * 0.4 + Math.sin(t + 1) * r * 0.35,
    x - face * r * 2.3, y - r * 0.1 + Math.sin(t + 2) * r * 0.4,
  );
  ctx.stroke();

  /* back feet */
  ctx.fillStyle = o.pal.accent;
  for (const s of [-1, 1]) {
    const off = Math.sin(o.walkT * Math.PI * 2 + (s > 0 ? 0 : Math.PI)) * r * 0.14;
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.34, y + r * 0.78 + off, r * 0.2, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* body */
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.02, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(50,32,18,0.55)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  /* belly */
  ctx.beginPath();
  ctx.ellipse(face * r * 0.18, r * 0.22, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();
  ctx.restore();

  /* head */
  const hx = x + face * r * 0.55;
  const hy = y - r * 0.5 + bob;
  /* ears */
  for (const s of [-1, 1]) {
    const ex = hx + s * r * 0.34;
    const ey = hy - r * 0.55;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = o.pal.fur;
    ctx.fill();
    ctx.strokeStyle = 'rgba(50,32,18,0.45)';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = '#f2a7b3';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.62, r * 0.56, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(50,32,18,0.55)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  /* snout + nose */
  ctx.beginPath();
  ctx.ellipse(hx + face * r * 0.52, hy + r * 0.14, r * 0.26, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + face * r * 0.72, hy + r * 0.1, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#e58098';
  ctx.fill();

  /* whisker twitch */
  const twitch = Math.sin(o.tailT * 14) * r * 0.06;
  ctx.strokeStyle = 'rgba(60,45,35,0.65)';
  ctx.lineWidth = r * 0.035;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(hx + face * r * 0.62, hy + r * 0.12 + i * r * 0.1);
    ctx.lineTo(hx + face * (r * 1.25 + twitch), hy + r * 0.02 + i * r * 0.22 + twitch);
    ctx.stroke();
  }

  /* chew cheeks */
  if (o.mood === 'chew') {
    ctx.fillStyle = o.pal.fur;
    const puff = Math.abs(Math.sin(o.tailT * 10)) * r * 0.1 + r * 0.16;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + s * r * 0.3 + face * r * 0.2, hy + r * 0.22, puff, 0, Math.PI * 2);
      ctx.fill();
    }
    /* cheese wedge in paws */
    drawCheese(ctx, x + face * r * 0.9, y + r * 0.25, r * 0.3, o.tailT, false);
  }

  drawFace(ctx, hx, hy, r * 0.62, face, face * 0.9, 0, o, 'mouse');
  drawHat(ctx, o.hat, o.hatColor, r * 0.62 * 1.05);
  ctx.save();
  ctx.translate(hx, hy);
  drawHat(ctx, o.hat, o.hatColor, r * 0.66);
  ctx.restore();

  /* front paws */
  ctx.fillStyle = o.pal.accent;
  for (const s of [-1, 1]) {
    const off = Math.sin(o.walkT * Math.PI * 2 + (s > 0 ? Math.PI : 0)) * r * 0.14;
    ctx.beginPath();
    ctx.ellipse(x + face * r * 0.5 + s * r * 0.3, y + r * 0.72 + off, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: DrawOpts): void {
  const walk = Math.sin(o.walkT * Math.PI * 2);
  const face = o.hue !== undefined && o.hue < 0 ? -1 : 1;
  const pounce = o.mood === 'pounce';
  const stretch = pounce ? 1.14 : 1;
  const bob = walk * r * 0.05;
  const sy = 1 + walk * 0.045;
  const sx = 1 - walk * 0.045;

  /* tail — curled sine */
  ctx.strokeStyle = o.pal.accent;
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - face * r * 0.9, y + r * 0.05);
  const t = o.tailT * Math.PI * 2;
  ctx.bezierCurveTo(
    x - face * r * 1.6, y - r * 0.2 + Math.sin(t) * r * 0.3,
    x - face * r * 1.9, y - r * 0.9 + Math.sin(t + 1.2) * r * 0.25,
    x - face * r * 1.4, y - r * 1.05 + Math.sin(t + 2) * r * 0.2,
  );
  ctx.stroke();

  /* feet */
  ctx.fillStyle = o.pal.accent;
  for (const s of [-1, 1]) {
    const off = Math.sin(o.walkT * Math.PI * 2 + (s > 0 ? 0 : Math.PI)) * r * 0.16;
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.42 + face * r * 0.15, y + r * 0.82 + off, r * 0.2, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* body */
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(sx * stretch, sy);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 1.05, r * 0.78, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(35,28,24,0.5)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  /* stripes */
  ctx.strokeStyle = o.pal.accent;
  ctx.lineWidth = r * 0.12;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(-face * r * (0.15 + i * 0.3), r * -0.28, r * 0.3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  /* belly */
  ctx.beginPath();
  ctx.ellipse(face * r * 0.2, r * 0.3, r * 0.48, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();
  ctx.restore();

  /* head — big, with pointed ears */
  const hx = x + face * r * 0.6;
  const hy = y - r * 0.55 + bob;
  for (const s of [-1, 1]) {
    const ex = hx + s * r * 0.42;
    const ey = hy - r * 0.5;
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.24, ey + r * 0.14);
    ctx.lineTo(ex + s * r * 0.08, ey - r * 0.42);
    ctx.lineTo(ex + r * 0.26, ey + r * 0.2);
    ctx.closePath();
    ctx.fillStyle = o.pal.fur;
    ctx.fill();
    ctx.strokeStyle = 'rgba(35,28,24,0.45)';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.12, ey + r * 0.06);
    ctx.lineTo(ex + s * r * 0.02, ey - r * 0.2);
    ctx.lineTo(ex + r * 0.12, ey + r * 0.1);
    ctx.closePath();
    ctx.fillStyle = '#f2a7b3';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.66, r * 0.58, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(35,28,24,0.5)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  /* muzzle */
  ctx.beginPath();
  ctx.ellipse(hx + face * r * 0.3, hy + r * 0.22, r * 0.4, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + face * r * 0.56, hy + r * 0.1, r * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#e58098';
  ctx.fill();

  drawFace(ctx, hx, hy, r * 0.66, face, face * 0.9, 0, o, 'cat');
  ctx.save();
  ctx.translate(hx, hy);
  drawHat(ctx, o.hat, o.hatColor, r * 0.7);
  ctx.restore();
}

function drawDog(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: DrawOpts): void {
  const walk = Math.sin(o.walkT * Math.PI * 2);
  const face = o.hue !== undefined && o.hue < 0 ? -1 : 1;
  const bob = walk * r * 0.06;

  /* tail — happy wag */
  ctx.strokeStyle = o.pal.accent;
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - face * r * 0.9, y + r * 0.1);
  const t = o.tailT * Math.PI * 4;
  ctx.quadraticCurveTo(x - face * r * 1.6, y - r * 0.3, x - face * r * 1.5, y - r * 0.7 + Math.sin(t) * r * 0.35);
  ctx.stroke();

  /* feet */
  ctx.fillStyle = o.pal.accent;
  for (const s of [-1, 1]) {
    const off = Math.sin(o.walkT * Math.PI * 2 + (s > 0 ? 0 : Math.PI)) * r * 0.18;
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.45 + face * r * 0.1, y + r * 0.82 + off, r * 0.22, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* body — longer */
  ctx.beginPath();
  ctx.ellipse(x, y + bob + r * 0.08, r * 1.18, r * 0.74, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,30,22,0.5)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + face * r * 0.15, y + bob + r * 0.3, r * 0.55, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();

  /* head with floppy ears + long snout */
  const hx = x + face * r * 0.72;
  const hy = y - r * 0.5 + bob;
  for (const s of [-1, 1]) {
    const ex = hx + s * r * 0.5;
    const ey = hy - r * 0.05;
    ctx.save();
    ctx.translate(ex, ey - r * 0.15);
    ctx.rotate(s * (0.5 + Math.sin(o.tailT * 3 + s) * 0.05));
    ctx.beginPath();
    ctx.ellipse(0, r * 0.2, r * 0.2, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = o.pal.accent;
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.62, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.fur;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,30,22,0.5)';
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  /* snout */
  ctx.beginPath();
  ctx.ellipse(hx + face * r * 0.5, hy + r * 0.2, r * 0.42, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fillStyle = o.pal.belly;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + face * r * 0.88, hy + r * 0.12, r * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = '#33261e';
  ctx.fill();
  /* tongue when hunting */
  if (o.mood === 'pounce' || o.mood === 'panic') {
    ctx.beginPath();
    ctx.ellipse(hx + face * r * 0.82, hy + r * 0.42, r * 0.1, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e56d7f';
    ctx.fill();
  }

  drawFace(ctx, hx, hy, r * 0.62, face, face * 0.9, 0, o, 'dog');
  ctx.save();
  ctx.translate(hx, hy);
  drawHat(ctx, o.hat, o.hatColor, r * 0.66);
  ctx.restore();
}

function drawCritter(ctx: CanvasRenderingContext2D, species: Species, x: number, y: number, r: number, o: DrawOpts): void {
  if (species === 'mouse') drawMouse(ctx, x, y, r, o);
  else if (species === 'cat') drawCat(ctx, x, y, r, o);
  else drawDog(ctx, x, y, r, o);
}

function drawCheese(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, glow: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  const s = 1 + Math.sin(t * 3) * 0.05;
  ctx.scale(s, s);
  if (glow) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.1);
    g.addColorStop(0, 'rgba(251,191,36,0.28)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.7);
  ctx.lineTo(r, r * 0.7);
  ctx.lineTo(r * 0.15, -r * 0.75);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = r * 0.12;
  ctx.stroke();
  ctx.fillStyle = 'rgba(180,83,9,0.5)';
  ctx.beginPath();
  ctx.arc(-r * 0.3, r * 0.3, r * 0.16, 0, Math.PI * 2);
  ctx.arc(r * 0.4, r * 0.35, r * 0.12, 0, Math.PI * 2);
  ctx.arc(r * 0.1, r * 0.05, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ============================ misc drawing ============================= */

function hatchWall(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  pal: typeof THEME_PALETTES[MazeTheme], seed: number, fancy: boolean,
): void {
  ctx.fillStyle = pal.wall;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = pal.wallEdge;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5);
  if (!fancy) return;
  /* hand-drawn hatching with per-cell deterministic wobble */
  ctx.strokeStyle = pal.hatch;
  ctx.lineWidth = 1.2;
  const w1 = ((seed * 2654435761) % 7) / 7 - 0.5;
  const w2 = ((seed * 40503) % 9) / 9 - 0.5;
  ctx.beginPath();
  ctx.moveTo(x + s * (0.15 + w1 * 0.1), y + s * 0.85);
  ctx.lineTo(x + s * 0.5, y + s * (0.35 + w2 * 0.1));
  ctx.lineTo(x + s * 0.9, y + s * 0.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.2, y + s * 0.55);
  ctx.lineTo(x + s * 0.62, y + s * 0.12);
  ctx.stroke();
}

/* ============================ component ================================ */

export function CheesyPursuitGame({ onExit }: { onExit: () => void }) {
  const { t, locale } = useApp();
  const rtl = locale === 'fa' || locale === 'ar';

  useGameSession(true);

  const [booted, setBooted] = useState(false);
  const [screen, setScreen] = useState<Screen>('menu');
  const [save, setSave] = useState<CPSave>(() => defaultCPSave());
  const [selLevel, setSelLevel] = useState(1);
  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('banner');
  const [banner, setBanner] = useState<{ text: string; sub?: string; danger?: boolean; key: number } | null>(null);
  const [hud, setHud] = useState<HudMirror | null>(null);
  const [result, setResult] = useState<{ r: RunResult; stars: number; rewards: ArcadeSubmitResult | null } | null>(null);
  const [hasTouch, setHasTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  /* shop */
  const [shopOwned, setShopOwned] = useState<string[]>([]);
  const [shopCoins, setShopCoins] = useState<number | null>(null);
  const [shopLoading, setShopLoading] = useState(false);

  const gRef = useRef<Game | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const saveRef = useRef(save);
  const selLevelRef = useRef(1);
  const sprintBtnRef = useRef(false);
  const bannerKeyRef = useRef(1);
  const endRef = useRef<(r: RunResult) => void>(() => undefined);
  const pauseRef = useRef<() => void>(() => undefined);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    endRef.current = (r) => finishRun(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* client boot: save + touch detection */
  useEffect(() => {
    setSave(loadCPSave());
    setHasTouch(isTouchDevice());
    const orient = () => setPortrait(window.innerHeight > window.innerWidth * 1.05);
    orient();
    window.addEventListener('resize', orient);
    window.addEventListener('orientationchange', orient);
    return () => {
      window.removeEventListener('resize', orient);
      window.removeEventListener('orientationchange', orient);
    };
  }, []);

  const persist = useCallback((next: CPSave) => {
    saveCPSave(next);
    setSave({ ...next });
  }, []);

  const dNum = useCallback((n: number | string) => localizeDigits(n, locale), [locale]);

  const showBanner = useCallback((text: string, sub?: string, danger?: boolean) => {
    bannerKeyRef.current += 1;
    setBanner({ text, sub, danger, key: bannerKeyRef.current });
  }, []);

  /* ------------------------- role/mode/char pickers ------------------- */
  const pickRole = (role: CRole) => { const s = { ...saveRef.current, role }; persist(s); sfx.click(); };
  const pickMode = (mode: CMode) => { const s = { ...saveRef.current, mode }; persist(s); sfx.click(); };
  const pickChar = (c: CharDef) => {
    const s = { ...saveRef.current };
    if (c.species === 'mouse') s.selMouse = c.code;
    else if (c.species === 'cat') s.selCat = c.code;
    else s.selDog = c.code;
    persist(s);
    sfx.click();
  };

  const charOwned = (c: CharDef): boolean => c.price === 0 || shopOwned.includes(c.code);

  /* ------------------------------ shop ------------------------------- */
  const refreshShop = useCallback(async () => {
    setShopLoading(true);
    try {
      const r = await api.get<{ items: { code: string }[]; owned: string[]; me: { coins: number } | null }>('/api/store');
      setShopOwned(r.owned);
      setShopCoins(r.me ? r.me.coins : null);
      const { patchUser } = useApp.getState();
      if (r.me) patchUser({ coins: r.me.coins });
    } catch {
      /* offline — free defaults still selectable */
    } finally {
      setShopLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen === 'shop') void refreshShop();
  }, [screen, refreshShop]);

  const buyChar = async (c: CharDef) => {
    const { user, t: tt } = useApp.getState();
    if (!user) { sfx.bad(); toast.error(tt('cp_login_needed')); return; }
    try {
      const r = await api.post<{ ok: boolean; coins: number }>('/api/store', { code: c.code });
      sfx.achievement();
      toast.success(t('cp_purchase_ok'));
      const { patchUser } = useApp.getState();
      patchUser({ coins: r.coins });
      setShopCoins(r.coins);
      await refreshShop();
    } catch (e) {
      const msg = (e as Error).message;
      sfx.bad();
      if (msg === 'COINS') toast.error(t('cp_not_enough'));
      else if (msg === 'LEVEL') toast.error(`${t('cp_need_level')} ${dNum(c.reqLevel)}`);
      else if (msg === 'OWNED') toast.info(t('cp_owned_err'));
      else if (msg === 'AUTH') toast.error(t('cp_login_needed'));
      else toast.error(useApp.getState().t('error'));
    }
  };

  /* --------------------------- level flow ---------------------------- */
  const openBrief = (level: number) => {
    setSelLevel(level);
    setScreen('brief');
    sfx.click();
  };

  const deploy = useCallback(() => {
    setResult(null);
    setBanner(null);
    setHud(null);
    setPhase('banner');
    setRunKey((k) => k + 1);
    setScreen('game');
    sfx.click();
  }, []);

  const retry = useCallback(() => {
    setResult(null);
    setBanner(null);
    setHud(null);
    setPhase('banner');
    setRunKey((k) => k + 1);
    sfx.click();
  }, []);

  const toMap = useCallback(() => {
    gRef.current = null;
    setResult(null);
    setScreen('levels');
    sfx.click();
  }, []);

  /* ------------------------- run completion -------------------------- */
  const finishRun = (r: RunResult) => {
    const s = saveRef.current;
    const level = selLevelRef.current;
    const rec = s.levels[String(level)] ?? { stars: 0, cleared: false, best: 0 };
    const firstClear = !rec.cleared;
    if (r.won) {
      rec.stars = Math.max(rec.stars, r.stars);
      rec.cleared = true;
      rec.best = Math.max(rec.best, r.score);
      s.stats.wins += 1;
      s.stats.cheese += r.cheese;
      if (s.role === 'cat') s.stats.catches += 1;
    }
    s.stats.runs += 1;
    if (r.score > s.stats.best) s.stats.best = r.score;
    s.levels[String(level)] = rec;
    persist(s);

    if (r.won) sfx.win();
    else sfx.lose();

    setResult({ r, stars: r.stars, rewards: null });

    if (r.won && useApp.getState().user) {
      submitArcade('cheese', r.score, {
        level, role: s.role, mode: s.mode, stars: r.stars, cheese: r.cheese,
      })
        .then((res) => {
          if (res) announceArcadeRewards(res);
          setResult((prev) => (prev ? { ...prev, rewards: res } : prev));
        })
        .catch(() => undefined);
    }
  };

  useEffect(() => { selLevelRef.current = selLevel; }, [selLevel]);

  /* =========================== THE ENGINE ============================ */
  useEffect(() => {
    if (screen !== 'game') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const app = useApp.getState();
    const lowFx = app.perfMode || canvas.clientWidth < 420;
    const dpr = Math.min(app.perfMode ? 1 : 2, window.devicePixelRatio || 1);

    const s = saveRef.current;
    const level = selLevelRef.current;
    const def = buildLevel(level);
    const lay = solveLayout(def);
    const role = s.role;
    const dogMode = s.mode === 'dogs';
    const tier = def.catTier;

    /* selected characters */
    const mouseChar = CHAR_BY_CODE[s.selMouse] ?? CHAR_BY_CODE[FREE_MOUSE];
    const hunterChar = dogMode
      ? (CHAR_BY_CODE[s.selDog] ?? CHARACTERS.find((c) => c.species === 'dog'))
      : (CHAR_BY_CODE[s.selCat] ?? CHAR_BY_CODE[FREE_CAT]);
    const minionChar = dogMode
      ? (CHARACTERS.find((c) => c.species === 'dog' && c.code !== hunterChar.code) ?? hunterChar)
      : hunterChar;
    const perkOf = (p: Perk, k: keyof Perk): number => (p[k] as number | undefined) ?? 0;

    /* backing store */
    const resize = () => {
      const w = canvas.clientWidth || 640;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * (lay.maze.rows / lay.maze.cols) * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /* ------------------------- game state ---------------------------- */
    let idSeq = 1;
    const maze = lay.maze;
    const brain = new PackBrain(maze, tier);
    const brainPathLen = (a: Actor, c: number, r: number): number => astarPath(maze, Math.floor(a.x), Math.floor(a.y), c, r).length;

    const mkActor = (species: Species, ch: CharDef, x: number, y: number, speed: number, accel: number, roleV: Role): Actor => ({
      id: idSeq++,
      species, pal: ch.palette, hat: ch.hat, hatColor: ch.hatColor,
      x, y, vx: 0, vy: 0, ang: 0,
      speed, accel, path: [], role: roleV,
      walkT: 0, mood: 'calm', moodT: 0, blinkT: 2 + Math.random() * 3,
      spawnT: roleV === 'leader' || roleV === 'chase' ? 0 : SPAWN_FADE,
      repathT: 0, burstUntil: 0, burstMul: 1, stuckT: 0, fx: Math.random() * 10,
    });

    const mouseSpeed = def.mouseSpeed * (1 + perkOf(mouseChar.perk, 'speedPct') / 100) * (role === 'cat' ? 0.92 : 1);
    const hunterBase = def.catSpeed * (dogMode ? DOG_STRAIGHT : 1);
    const hunterAccel = dogMode ? DOG_ACCEL : CAT_ACCEL;

    const mouse = mkActor('mouse', mouseChar, lay.mouseSpawn.c + 0.5, lay.mouseSpawn.r + 0.5, mouseSpeed, CAT_ACCEL, role === 'mouse' ? 'leader' : 'wander');

    const player = role === 'cat'
      ? mkActor(hunterChar.species, hunterChar, lay.catSpawns[0].c + 0.5, lay.catSpawns[0].r + 0.5, hunterBase * (1 + perkOf(hunterChar.perk, 'speedPct') / 100), hunterAccel, 'leader')
      : null;

    const hunters: Actor[] = [];
    let gTime = 0; // global anim clock — declared early: spawnHunter reads it during setup
    const spawnHunter = (idx: number) => {
      const spot = lay.catSpawns[idx % lay.catSpawns.length];
      const ch = idx === 0 && role === 'cat' ? hunterChar : (Math.random() < 0.5 ? hunterChar : minionChar);
      const sp = hunterBase * (1 + perkOf(ch.perk, 'speedPct') / 100);
      const h = mkActor(ch.species, ch, spot.c + 0.5, spot.r + 0.5, sp, hunterAccel, role === 'cat' ? 'chase' : 'wander');
      h.spawnT = SPAWN_FADE;
      hunters.push(h);
      brain.assign(hunters, lay.burrow, cheese, gTime, brainPathLen);
    };

    const cheese: CheeseCell[] = lay.cheeseCells.map((q) => ({ c: q.c, r: q.r, taken: false, sparkT: Math.random() * 10 }));
    const totalCheese = cheese.length;

    const g: Game = {
      phase: 'banner',
      def, lay, role, mode: dogMode ? 'dogs' : 'cats', dogMode,
      mouse, player, hunters, cheese,
      collected: 0,
      burrowOpen: false,
      winT: 0,
      timeLeft: def.parMs * 1.35,
      stamina: 100 * (1 + perkOf(mouseChar.perk, 'staminaPct') / 100),
      staminaMax: 100 * (1 + perkOf(mouseChar.perk, 'staminaPct') / 100),
      sprinting: false,
      score: 0, combo: 0, comboT: 0,
      shake: 0, flash: 0, time: 0,
      parts: [], pops: [],
      keys: new Set<string>(),
      stick: { active: false, dx: 0, dy: 0, id: -1 },
      brain,
      mouseBrain: role === 'cat' ? new MouseBrain(maze, tier) : null,
      spawnQueue: role === 'cat' ? def.cats - 1 : def.initialCats,
      spawnedCount: role === 'cat' ? 1 : 0,
      nextSpawnAt: def.spawnEvery,
      graceT: GRACE_MS,
      bannerT: 1500,
      lowFx,
      senseBonus: 1 + perkOf(mouseChar.perk, 'sensePct') / 100,
    };
    gRef.current = g as Game;

    /* role 'cat': leader occupies spawn slot 0 — spawn the rest */
    if (role === 'cat') {
      for (let i = 0; i < g.spawnQueue; i++) {
        if (def.spawnEvery === 0 || i < 1) spawnHunter(i + 1);
        else break;
      }
      g.spawnQueue -= hunters.length;
      g.nextSpawnAt = def.spawnEvery;
    } else {
      for (let i = 0; i < def.initialCats; i++) spawnHunter(i);
    }
    /* keep the generic counters honest */
    g.spawnedCount = role === 'cat' ? 1 + hunters.length : hunters.length;

    /* ---------------------------- fx ------------------------------- */
    const partCap = lowFx ? 160 : 340;
    const addParts = (x: number, y: number, c: string, n: number, speed: number, conf = false) => {
      const cap = lowFx ? Math.ceil(n / 2) : n;
      for (let i = 0; i < cap; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.8);
        g.parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (conf ? 2.4 : 0),
          life: conf ? 1400 + Math.random() * 1200 : 380 + Math.random() * 420,
          max: conf ? 2600 : 800, c, r: conf ? 2.4 : 1.4 + Math.random() * 1.8,
          spin: Math.random() * Math.PI * 2, conf,
        });
      }
      if (g.parts.length > partCap) g.parts.splice(0, g.parts.length - partCap);
    };
    const pop = (x: number, y: number, txt: string, c: string) => {
      g.pops.push({ x, y, txt, c, life: 1000, max: 1000 });
    };
    const dNum2 = (n: number | string) => localizeDigits(n, useApp.getState().locale);

    /* --------------------------- banner ----------------------------- */
    if (role === 'mouse') showBanner(t('cp_objective_mouse'), `${t('cp_tier')}: ${t(`cp_tier_${tier}` as never)}`, false);
    else showBanner(t('cp_objective_cat'), `${t('cp_tier')}: ${t(`cp_tier_${tier}` as never)}`, false);

    /* --------------------------- input ------------------------------ */
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (down) {
        if (k === 'escape') { pauseRef.current(); return; }
        g.keys.add(k);
      } else {
        g.keys.delete(k);
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    const onHidden = () => {
      if (document.hidden && g.phase === 'playing') { g.phase = 'paused'; setPhase('paused'); }
    };
    document.addEventListener('visibilitychange', onHidden);

    pauseRef.current = () => {
      if (g.phase === 'playing') { g.phase = 'paused'; setPhase('paused'); sfx.click(); }
      else if (g.phase === 'paused') { g.phase = 'playing'; setPhase('playing'); sfx.click(); }
    };

    /* ----------------------- movement core -------------------------- */
    const moveActor = (a: Actor, dx: number, dy: number, dt: number, burst: number): void => {
      const len = Math.hypot(dx, dy);
      const targetVx = len > 0.01 ? (dx / len) * a.speed * burst : 0;
      const targetVy = len > 0.01 ? (dy / len) * a.speed * burst : 0;
      const k = 1 - Math.exp(-a.accel * dt);
      a.vx += (targetVx - a.vx) * k;
      a.vy += (targetVy - a.vy) * k;
      /* separation steering between hunters (T3+) */
      if (a.species !== 'mouse' && tier >= 3) {
        for (const h of hunters) {
          if (h === a) continue;
          const ddx = a.x - h.x;
          const ddy = a.y - h.y;
          const d = Math.hypot(ddx, ddy);
          if (d > 0.001 && d < 1.05) {
            const push = (1.05 - d) * 2.6;
            a.vx += (ddx / d) * push * dt * 10;
            a.vy += (ddy / d) * push * dt * 10;
          }
        }
      }
      const r = ACTOR_R;
      const nx = a.x + a.vx * dt;
      if (!circleHitsWall(maze, nx, a.y, r)) a.x = nx; else a.vx = 0;
      const ny = a.y + a.vy * dt;
      if (!circleHitsWall(maze, a.x, ny, r)) a.y = ny; else a.vy = 0;
      if (Math.hypot(a.vx, a.vy) > 0.2) a.ang = Math.atan2(a.vy, a.vx);
      a.walkT += Math.hypot(a.vx, a.vy) * dt * 1.9;
    };

    const stepAlongPath = (a: Actor, dt: number, burst: number): boolean => {
      if (a.path.length === 0) return false;
      const wp = a.path[0];
      const tx = wp.c + 0.5;
      const ty = wp.r + 0.5;
      const dx = tx - a.x;
      const dy = ty - a.y;
      if (Math.hypot(dx, dy) < 0.18) {
        a.path.shift();
        return a.path.length > 0;
      }
      moveActor(a, dx, dy, dt, burst);
      return true;
    };

    const hasLOS = (ax: number, ay: number, bx: number, by: number): boolean => {
      /* Bresenham-ish sampling on the cell grid */
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
      for (let i = 1; i < steps; i++) {
        const x = ax + ((bx - ax) * i) / steps;
        const y = ay + ((by - ay) * i) / steps;
        const c = Math.floor(x);
        const r = Math.floor(y);
        if (c < 0 || r < 0 || c >= maze.cols || r >= maze.rows) return false;
        if (maze.grid[r * maze.cols + c] === 1) return false;
      }
      return true;
    };

    /* ------------------------- end conditions ----------------------- */
    let finished = false;
    const win = (reason: RunResult['reason']) => {
      if (finished) return;
      finished = true;
      g.phase = 'won';
      setPhase('won');
      if (reason === 'escape') g.winT = 950;
      const elapsed = def.parMs * 1.35 - g.timeLeft;
      const stars = elapsed <= def.parMs * 0.5 ? 3 : elapsed <= def.parMs * 0.75 ? 2 : 1;
      const timeBonus = Math.round(300 * clamp(g.timeLeft / (def.parMs * 1.35), 0, 1));
      const score = reason === 'escape'
        ? g.score + 400 + timeBonus + stars * 50
        : g.score + 250 + (totalCheese - g.collected) * 40 + timeBonus + stars * 50;
      g.score = score;
      addParts(mouse.x * CELL, mouse.y * CELL, '#fbbf24', lowFx ? 24 : 48, 3.2, true);
      endRef.current({ won: true, reason, score, stars, timeMs: Math.round(elapsed), cheese: g.collected });
    };
    const lose = (reason: RunResult['reason']) => {
      if (finished) return;
      finished = true;
      g.phase = 'lost';
      setPhase('lost');
      g.shake = 1;
      g.flash = 1;
      const elapsed = def.parMs * 1.35 - g.timeLeft;
      endRef.current({ won: false, reason, score: g.score, stars: 0, timeMs: Math.round(elapsed), cheese: g.collected });
    };

    /* --------------------------- main loop -------------------------- */
    let raf = 0;
    let last = performance.now();
    let hudT = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dtMs = Math.min(50, now - last);
      last = now;
      const dt = dtMs / 1000;
      g.time += dt;
      g.shake = Math.max(0, g.shake - dt * 2.4);
      g.flash = Math.max(0, g.flash - dt * 2);

      if (g.phase === 'banner') {
        g.bannerT -= dtMs;
        if (g.bannerT <= 0) { g.phase = 'playing'; setPhase('playing'); }
      }

      const playing = g.phase === 'playing';
      if (playing) {
        gTime += dtMs;
        g.timeLeft -= dtMs;
        if (g.timeLeft <= 0) { lose('time'); }
        g.graceT = Math.max(0, g.graceT - dtMs);
        g.comboT = Math.max(0, g.comboT - dtMs);
        if (g.comboT === 0) g.combo = 0;

        /* timed hunter spawns */
        if (def.spawnEvery > 0 && g.spawnQueue > 0 && gTime >= g.nextSpawnAt) {
          g.nextSpawnAt = gTime + def.spawnEvery;
          spawnHunter(g.spawnedCount);
          g.spawnedCount++;
          g.spawnQueue--;
          showBanner(t('cp_spawn_warning'), undefined, true);
        }
      }

      /* ---------------- player input ---------------- */
      let ix = 0;
      let iy = 0;
      if (playing) {
        const k = g.keys;
        if (k.has('arrowleft') || k.has('a')) ix -= 1;
        if (k.has('arrowright') || k.has('d')) ix += 1;
        if (k.has('arrowup') || k.has('w')) iy -= 1;
        if (k.has('arrowdown') || k.has('s')) iy += 1;
        if (g.stick.active) { ix += g.stick.dx; iy += g.stick.dy; }
      }
      const wantsSprint = (g.keys.has('shift') || sprintBtnRef.current) && (ix !== 0 || iy !== 0);

      /* -------- mouse entity (player or AI) -------- */
      if (g.phase === 'playing' || g.phase === 'banner') {
        if (g.role === 'mouse') {
          g.sprinting = wantsSprint && g.stamina > 2;
          const spd = g.sprinting ? SPRINT_MUL : 1;
          g.stamina = clamp(g.stamina + (g.sprinting ? -SPRINT_DRAIN : SPRINT_REGEN) * dt, 0, g.staminaMax);
          moveActor(mouse, ix, iy, dt, spd);
          if (g.sprinting && Math.hypot(mouse.vx, mouse.vy) > 1 && Math.random() < dt * 14) {
            addParts(mouse.x * CELL, mouse.y * CELL, 'rgba(180,160,130,0.5)', 1, 0.6);
          }
          if (ix !== 0 || iy !== 0) mouse.mood = 'calm';
        } else {
          /* AI mouse brain */
          const target = g.mouseBrain ? g.mouseBrain.plan(mouse, hunters, cheese, lay.burrow, gTime) : lay.burrow;
          mouse.repathT -= dtMs;
          const cur = { c: Math.floor(mouse.x), r: Math.floor(mouse.y) };
          if (mouse.repathT <= 0 || mouse.path.length === 0) {
            mouse.repathT = 220;
            mouse.path = astarPath(maze, cur.c, cur.r, target.c, target.r);
          }
          stepAlongPath(mouse, dt, 1);
        }

        /* cheese pickup */
        for (const ch of cheese) {
          if (ch.taken) continue;
          const cx = ch.c + 0.5;
          const cy = ch.r + 0.5;
          ch.sparkT += dt;
          if (Math.hypot(mouse.x - cx, mouse.y - cy) < EAT_DIST) {
            ch.taken = true;
            g.collected++;
            g.combo++;
            g.comboT = COMBO_WINDOW;
            const gain = 100 + (g.combo - 1) * 10;
            g.score += gain;
            pop(cx * CELL, cy * CELL, `+${dNum2(gain)}`, '#fbbf24');
            addParts(cx * CELL, cy * CELL, '#fcd34d', lowFx ? 4 : 9, 1.6);
            if (g.role === 'mouse') { mouse.mood = 'chew'; mouse.moodT = 600; }
            if (g.collected >= totalCheese) {
              g.burrowOpen = true;
              showBanner(t('cp_all_cheese'), undefined, false);
            }
          }
        }

        /* burrow escape */
        if (g.burrowOpen) {
          const bx = lay.burrow.c + 0.5;
          const by = lay.burrow.r + 0.5;
          if (Math.hypot(mouse.x - bx, mouse.y - by) < 0.62) {
            win('escape');
          }
        }
      }

      /* -------- hunters -------- */
      if (playing) {
        /* sense the mouse (shared blackboard) */
        const sight = brain.spec.sightCells * (dogMode ? 0.92 : 1);
        for (const h of hunters) {
          if (h.spawnT > 0) continue;
          const d = Math.hypot(h.x - mouse.x, h.y - mouse.y);
          if (d < sight && hasLOS(h.x, h.y, mouse.x, mouse.y)) {
            brain.report(mouse.x, mouse.y, gTime, { x: mouse.vx, y: mouse.vy });
            h.mood = d < 2.2 ? 'pounce' : 'calm';
            h.moodT = 700;
          }
        }
        brain.refreshBlackboard(gTime);
        const anchorChanged = brain.assign(hunters, lay.burrow, cheese, gTime, brainPathLen);
        if (anchorChanged) brain.rebuildChoke(cheese, lay.burrow, { c: Math.floor(mouse.x), r: Math.floor(mouse.y) });

        for (const h of hunters) {
          if (h.spawnT > 0) { h.spawnT -= dtMs; continue; }
          const roleV = brain.roleOf(h.id);
          const burst = gTime < h.burstUntil ? h.burstMul : 1;
          h.repathT -= dtMs;
          if (h.repathT <= 0) {
            h.repathT = brain.spec.reactionMs + 50;
            const cur = { c: Math.floor(h.x), r: Math.floor(h.y) };
            let tc: { c: number; r: number } | null = null;

            if (roleV === 'chase' || roleV === 'flank') {
              const anchor = brain.predicted ?? (brain.seenFresh(gTime) && brain.lastSeen ? { x: brain.lastSeen.x, y: brain.lastSeen.y } : null);
              if (anchor) {
                tc = nearestFloor(maze, anchor.x, anchor.y);
                /* flanker routes through loops: block the chaser's mid-cell */
                if (roleV === 'flank') {
                  const chaser = hunters.find((q) => brain.roleOf(q.id) === 'chase');
                  if (chaser && chaser.path.length > 2) {
                    const mid = chaser.path[Math.floor(chaser.path.length / 2)];
                    h.path = loopPath(maze, cur, tc, mid);
                    tc = null;
                  }
                }
              } else {
                tc = null; /* no intel → patrol toward random cell */
                if (h.path.length === 0) tc = randomFloorCell(maze);
              }
            } else if (roleV === 'intercept' || roleV === 'guard' || roleV === 'wander') {
              const tgt = brain.targetOf(h.id);
              tc = tgt ?? randomFloorCell(maze);
              /* arrived at guard post → hold position */
              if (tgt && cur.c === tgt.c && cur.r === tgt.r) tc = null;
              if (roleV === 'wander' && h.path.length === 0) tc = randomFloorCell(maze);
            }

            if (tc) {
              h.path = astarPath(maze, cur.c, cur.r, tc.c, tc.r);
              /* T3+: direct pounce when close & visible */
              const d = Math.hypot(h.x - mouse.x, h.y - mouse.y);
              if ((roleV === 'chase' || roleV === 'flank') && d < 2.6 && hasLOS(h.x, h.y, mouse.x, mouse.y)) {
                h.path = [{ c: Math.floor(mouse.x), r: Math.floor(mouse.y) }];
              }
            }
          }
          const moved = stepAlongPath(h, dt, burst);
          if (!moved && (roleV === 'chase' || roleV === 'flank')) {
            const anchor = brain.predicted ?? (brain.seenFresh(gTime) && brain.lastSeen ? { x: brain.lastSeen.x, y: brain.lastSeen.y } : null);
            if (anchor) moveActor(h, anchor.x - h.x, anchor.y - h.y, dt, burst);
          }
          if (moved && Math.hypot(h.vx, h.vy) < h.speed * 0.3) h.stuckT += dtMs; else h.stuckT = 0;
          if (h.stuckT > 600) { h.path = []; h.stuckT = 0; h.repathT = 0; }
          h.moodT = Math.max(0, h.moodT - dtMs);
          if (h.moodT === 0 && h.mood !== 'calm') h.mood = 'calm';
        }

        /* catch checks */
        if (g.graceT <= 0) {
          for (const h of hunters) {
            if (h.spawnT > 0) continue;
            const d = Math.hypot(h.x - mouse.x, h.y - mouse.y);
            if (d < CATCH_DIST) {
              if (g.role === 'mouse') {
                lose('caught');
              } else {
                win('caught');
              }
              break;
            }
          }
        }

        /* AI mouse mood: panic when close */
        if (g.role === 'cat') {
          let nearest = Infinity;
          for (const h of hunters) {
            if (h.spawnT > 0) continue;
            nearest = Math.min(nearest, Math.hypot(h.x - mouse.x, h.y - mouse.y));
          }
          if (player) nearest = Math.min(nearest, Math.hypot(player.x - mouse.x, player.y - mouse.y));
          if (nearest < 2.4) { mouse.mood = 'panic'; mouse.moodT = 400; }
        }
      }

      /* player cat also moves in banner phase? no — only playing. */
      if (playing && g.player) {
        const p = g.player;
        const spd = wantsSprint ? SPRINT_MUL : 1;
        moveActor(p, ix, iy, dt, spd);
      }

      /* mood decay (mouse) */
      mouse.moodT = Math.max(0, mouse.moodT - dtMs);
      if (mouse.moodT === 0 && (mouse.mood === 'chew' || mouse.mood === 'panic')) mouse.mood = 'calm';
      mouse.blinkT -= dtMs;
      if (mouse.blinkT < -120) mouse.blinkT = 1800 + Math.random() * 2600;
      for (const h of hunters) {
        h.blinkT -= dtMs;
        if (h.blinkT < -120) h.blinkT = 1800 + Math.random() * 2600;
        h.fx += dt;
      }
      mouse.fx += dt;

      /* win pull-in */
      if (g.phase === 'won' && g.winT > 0) {
        g.winT -= dtMs;
        const bx = lay.burrow.c + 0.5;
        const by = lay.burrow.r + 0.5;
        mouse.x += (bx - mouse.x) * 0.14;
        mouse.y += (by - mouse.y) * 0.14;
      }

      /* particles + pops */
      for (const p of g.parts) {
        p.life -= dtMs;
        p.x += p.vx * dt * 30;
        p.y += p.vy * dt * 30;
        if (p.conf) p.vy += dt * 2.2;
        else { p.vx *= 0.98; p.vy = p.vy * 0.98 + dt * 1.2; }
      }
      g.parts = g.parts.filter((p) => p.life > 0);
      for (const p of g.pops) { p.life -= dtMs; p.y -= dtMs * 0.03; }
      g.pops = g.pops.filter((p) => p.life > 0);

      /* ------------------------ render ------------------------------ */
      render(g, ctx, canvas, dpr, def, lay, lowFx, gTime);

      /* hud mirror @ ~10Hz */
      hudT -= dtMs;
      if (hudT <= 0) {
        hudT = 120;
        let danger = false;
        for (const h of hunters) {
          if (h.spawnT > 0) continue;
          if (Math.hypot(h.x - mouse.x, h.y - mouse.y) < 2.4) { danger = true; break; }
        }
        setHud({
          cheese: g.collected, cheeseTotal: totalCheese, timeLeft: Math.max(0, Math.round(g.timeLeft / 1000)),
          stamina: Math.round((g.stamina / g.staminaMax) * 100), score: g.score,
          danger, tier, hunters: hunters.filter((h) => h.spawnT <= 0).length, open: g.burrowOpen,
        });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      document.removeEventListener('visibilitychange', onHidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, screen]);

  /* ------------------------- touch wiring --------------------------- */
  const setStick = (active: boolean, dx: number, dy: number, id: number) => {
    const g = gRef.current;
    if (g) g.stick = { active, dx, dy, id };
  };

  const padRef = useRef<HTMLDivElement | null>(null);
  const padOrigin = useRef<{ x: number; y: number } | null>(null);
  const onPadDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = padRef.current?.getBoundingClientRect();
    padOrigin.current = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: e.clientX, y: e.clientY };
    setStick(true, 0, 0, e.pointerId);
  };
  const onPadMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!padOrigin.current || !gRef.current?.stick.active) return;
    const dx = clamp((e.clientX - padOrigin.current.x) / 44, -1, 1);
    const dy = clamp((e.clientY - padOrigin.current.y) / 44, -1, 1);
    setStick(true, dx, dy, e.pointerId);
  };
  const onPadUp = () => {
    padOrigin.current = null;
    setStick(false, 0, 0, -1);
  };

  /* ============================== screens =========================== */

  if (!booted) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black" aria-label="CHEESY PURSUIT boot">
        <RetroBoot
          title="CHEESY PURSUIT"
          subtitle="FAAR-O-PANIR · 30 LEVEL MAZE CHASE"
          accent="#fbbf24"
          cartridgeIcon="🧀"
          onDone={() => { setBooted(true); setScreen('menu'); }}
        />
      </div>
    );
  }

  /* -------- shared chrome bits -------- */
  const backBtn = (
    <Button variant="outline" size="sm" className="bg-white/5" onClick={() => { sfx.click(); setScreen('menu'); }}>
      <ChevronLeft className="me-1 h-4 w-4 rotate-180 rtl:rotate-0" /> {t('cp_back_menu')}
    </Button>
  );

  const starsRow = (stars: number, size = 'text-lg') => (
    <div className={`flex justify-center gap-1 ${size}`} aria-label={`${stars} / 3`}>
      {[0, 1, 2].map((i) => (
        <Star key={i} className={`h-5 w-5 ${i < stars ? 'fill-amber-400 text-amber-400' : 'text-white/20'}`} />
      ))}
    </div>
  );

  /* ------------------------------ menu ------------------------------ */
  if (screen === 'menu') {
    const totalStars = starsTotal(save);
    return (
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col items-center justify-center gap-5 px-4 py-8" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="text-center">
          <p className="text-5xl">🐭🧀</p>
          <h1 className="gold-text mt-2 text-3xl font-black tracking-wide sm:text-4xl">CHEESY PURSUIT</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('cp_menu_sub')}</p>
        </div>

        {hasTouch && (
          <CharPreview code={save.role === 'mouse' ? save.selMouse : (save.mode === 'dogs' ? save.selDog : save.selCat)} size={88} />
        )}

        {/* role select */}
        <div className="w-full">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-amber-300/80">{t('cp_role')}</p>
          <div className="grid grid-cols-2 gap-3">
            {(['mouse', 'cat'] as CRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => pickRole(r)}
                className={`rounded-2xl border-2 p-4 text-start transition-all active:scale-[0.98] ${save.role === r ? 'border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-500/10' : 'border-white/10 bg-white/5 hover:border-white/25'}`}
                aria-pressed={save.role === r}
              >
                <span className="text-2xl">{r === 'mouse' ? '🐭' : '🐱'}</span>
                <span className="mt-1 block font-black">{t(r === 'mouse' ? 'cp_role_mouse' : 'cp_role_cat')}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{t(r === 'mouse' ? 'cp_role_mouse_desc' : 'cp_role_cat_desc')}</span>
              </button>
            ))}
          </div>
        </div>

        {/* mode select */}
        <div className="w-full">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-amber-300/80">{t('cp_mode')}</p>
          <div className="grid grid-cols-2 gap-3">
            {(['cats', 'dogs'] as CMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickMode(m)}
                className={`rounded-2xl border-2 p-3 text-center transition-all active:scale-[0.98] ${save.mode === m ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 bg-white/5 hover:border-white/25'}`}
                aria-pressed={save.mode === m}
              >
                <span className="text-xl">{m === 'cats' ? '🐱' : '🐕'}</span>
                <span className="ms-2 font-black">{t(m === 'cats' ? 'cp_mode_cats' : 'cp_mode_dogs')}</span>
              </button>
            ))}
          </div>
          {save.mode === 'dogs' && <p className="mt-1.5 text-center text-[11px] text-emerald-300/80">🐕 {t('cp_mode_dog_hint')}</p>}
        </div>

        {/* actions */}
        <div className="grid w-full gap-2">
          <Button className="glow-gold h-12 text-lg" onClick={() => openBrief(Math.min(30, Math.max(1, Object.keys(save.levels).length + 1)))}>
            <Play className="me-2 h-5 w-5" /> {t('cp_menu_play')}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => { sfx.click(); setScreen('levels'); }}>{t('cp_levels')}</Button>
            <Button variant="outline" onClick={() => { sfx.click(); setScreen('shop'); }}>
              <ShoppingBag className="me-1.5 h-4 w-4" /> {t('cp_menu_shop')}
            </Button>
            <Button variant="outline" onClick={() => { sfx.click(); setScreen('howto'); }}>{t('cp_menu_howto')}</Button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>⭐ {t('cp_stars_total')}: <b className="gold-text">{dNum(totalStars)}</b>/90</span>
          <span>🏆 {t('cp_best')}: <b className="gold-text">{dNum(save.stats.best)}</b></span>
        </div>

        <Button variant="ghost" size="sm" className="mt-auto text-muted-foreground" onClick={() => { sfx.click(); onExit(); }}>{t('cp_menu_exit')}</Button>
      </div>
    );
  }

  /* --------------------------- level select ------------------------- */
  if (screen === 'levels') {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-4 px-4 py-6" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between">
          {backBtn}
          <h2 className="gold-text text-xl font-black">🧀 {t('cp_levels')}</h2>
        </div>
        <p className="text-center text-xs text-muted-foreground">{t('cp_locked')}</p>
        <div className="grid max-h-[74dvh] grid-cols-2 gap-3 overflow-y-auto pe-1 sm:grid-cols-3 md:grid-cols-4 cp-scroll">
          {Array.from({ length: 30 }, (_, i) => i + 1).map((L) => {
            const unlocked = isLevelUnlocked(save, L);
            const rec = save.levels[String(L)];
            const def = buildLevel(L);
            const pal = THEME_PALETTES[def.theme];
            return (
              <button
                key={L}
                type="button"
                disabled={!unlocked}
                onClick={() => openBrief(L)}
                className={`rounded-2xl border-2 p-3 text-start transition-all ${unlocked ? 'border-white/10 bg-white/5 hover:border-amber-400/60 active:scale-[0.98]' : 'cursor-not-allowed border-white/5 bg-black/20 opacity-50'}`}
                aria-label={`${t('cp_level_n')} ${L}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-black">{dNum(L)}</span>
                  {unlocked ? <span className="text-xl">{def.dogMode ? '🐕' : '🐱'}</span> : <Lock className="h-4 w-4 text-white/40" />}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <Star key={i} className={`h-3 w-3 ${rec && i < rec.stars ? 'fill-amber-400 text-amber-400' : 'text-white/20'}`} />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-muted-foreground">
                  <span className="rounded bg-white/5 px-1.5 py-0.5">🧀 {dNum(def.cheese)}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5">{def.dogMode ? '🐕' : '🐱'} {dNum(def.cats)}</span>
                  <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: `${pal.accent}33`, color: pal.wall }}>{t(`cp_theme_${def.theme}` as never)}</span>
                </div>
                <div className="mt-1 text-[9px] font-bold text-amber-300/70">{t('cp_tier')}: {t(`cp_tier_${def.catTier}` as never)}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ----------------------------- how-to ----------------------------- */
  if (screen === 'howto') {
    const items: string[] = [
      t('cp_howto_mouse'), t('cp_howto_sprint'), t('cp_howto_goal'), t('cp_howto_ai'),
      t('cp_howto_cat_role'), t('cp_howto_dogs'), t('cp_howto_stars'),
    ];
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-4 px-4 py-6" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between">
          {backBtn}
          <h2 className="gold-text text-xl font-black">📖 {t('cp_howto_title')}</h2>
        </div>
        <div className="grid gap-2.5">
          {items.map((txt, i) => (
            <div key={i} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <span className="text-xl">{['🕹️', '💨', '🧀', '🧠', '🐱', '🐕', '⭐'][i]}</span>
              <p className="text-sm leading-relaxed text-foreground/90">{txt}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-bold text-amber-300">🧠 {t('cp_tier')}</p>
          <div className="mt-2 grid gap-1.5">
            {([1, 2, 3, 4, 5] as const).map((tr) => (
              <div key={tr} className="flex items-start gap-2 text-xs">
                <span className="min-w-24 rounded-md bg-amber-500/15 px-2 py-0.5 text-center font-black text-amber-300">{t(`cp_tier_${tr}` as never)}</span>
                <span className="text-muted-foreground">{t(`cp_tier_desc_${tr}` as never)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ shop ------------------------------ */
  if (screen === 'shop') {
    const speciesTab = save.role === 'mouse' ? 'mouse' : (save.mode === 'dogs' ? 'dog' : 'cat');
    const list = CHARACTERS.filter((c) => c.species === speciesTab);
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-4 px-4 py-6" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between">
          {backBtn}
          <div className="flex items-center gap-2">
            {shopCoins !== null && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm font-black text-amber-400">🪙 {dNum(shopCoins)}</span>
            )}
            <h2 className="gold-text text-xl font-black">🛒 {t('cp_shop_title')}</h2>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">{t('cp_shop_sub')} · {t('cp_shop_frees')}</p>
        {shopLoading && <p className="text-center text-xs text-muted-foreground">{t('loading')}</p>}
        <div className="grid max-h-[70dvh] grid-cols-1 gap-3 overflow-y-auto pe-1 sm:grid-cols-2 cp-scroll">
          {list.map((c) => {
            const owned = charOwned(c);
            const selCode = c.species === 'mouse' ? save.selMouse : c.species === 'cat' ? save.selCat : save.selDog;
            const selected = selCode === c.code;
            const rarityRing = c.rarity === 'LEGENDARY' ? 'border-amber-400/70 shadow-[0_0_18px_rgba(251,191,36,0.25)]'
              : c.rarity === 'EPIC' ? 'border-fuchsia-400/50'
              : c.rarity === 'RARE' ? 'border-emerald-400/50'
              : 'border-white/15';
            const perkList = Object.entries(c.perk) as [keyof Perk, number][];
            return (
              <div key={c.code} className={`rounded-2xl border-2 bg-white/5 p-4 ${rarityRing}`}>
                <div className="flex items-center gap-3">
                  <CharPreview code={c.code} size={64} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black">{charName(c, locale)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t(c.species === 'mouse' ? 'cp_species_mouse' : c.species === 'cat' ? 'cp_species_cat' : 'cp_species_dog' as never)} · {t(`rarity_${c.rarity}` as never)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {perkList.map(([k, v]) => (
                        <span key={k} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          +{dNum(v)}٪ {t(k === 'speedPct' ? 'cp_perk_speed' : k === 'staminaPct' ? 'cp_perk_stamina' : 'cp_perk_sense' as never)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {owned ? (
                    <Button
                      className={`flex-1 ${selected ? '' : 'glow-gold'}`}
                      variant={selected ? 'outline' : 'default'}
                      disabled={selected}
                      onClick={() => pickChar(c)}
                    >
                      {selected ? `✓ ${t('cp_selected')}` : t('cp_select')}
                    </Button>
                  ) : (
                    <Button className="flex-1 glow-gold" onClick={() => void buyChar(c)}>
                      <Zap className="me-1 h-4 w-4" /> {t('cp_buy')} · 🪙 {dNum(c.price)}
                    </Button>
                  )}
                  {owned && c.price > 0 && <span className="text-[10px] text-muted-foreground">{t('cp_owned')}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {!useApp.getState().user && <p className="text-center text-xs text-muted-foreground">🔒 {t('cp_shop_login')}</p>}
      </div>
    );
  }

  /* ------------------------------ brief ----------------------------- */
  if (screen === 'brief') {
    const def = buildLevel(selLevel);
    const pal = THEME_PALETTES[def.theme];
    const selChar = save.role === 'mouse'
      ? (CHAR_BY_CODE[save.selMouse] ?? CHAR_BY_CODE[FREE_MOUSE])
      : (save.mode === 'dogs' ? (CHAR_BY_CODE[save.selDog] ?? CHARACTERS.find((c) => c.species === 'dog')!) : (CHAR_BY_CODE[save.selCat] ?? CHAR_BY_CODE[FREE_CAT]));
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center gap-4 px-4 py-8" dir={rtl ? 'rtl' : 'ltr'}>
        <div className="text-center">
          <p className="text-4xl">{save.role === 'mouse' ? '🧀' : '🐾'}</p>
          <h2 className="gold-text mt-1 text-2xl font-black">{t('cp_brief_title')} — {t('cp_level_n')} {dNum(selLevel)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t(`cp_theme_${def.theme}` as never)} · {def.cols}×{def.rows}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
          <p className="font-bold text-amber-300">🎯 {save.role === 'mouse' ? t('cp_objective_mouse') : t('cp_objective_cat')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <span className="rounded-lg bg-black/30 px-2 py-1.5 text-center">🧀 {dNum(def.cheese)} {t('cp_hud_cheese')}</span>
            <span className="rounded-lg bg-black/30 px-2 py-1.5 text-center">{def.dogMode ? '🐕' : '🐱'} {dNum(def.cats)} {t(def.dogMode ? 'cp_mode_dogs' : 'cp_mode_cats' as never)}</span>
            <span className="rounded-lg bg-black/30 px-2 py-1.5 text-center"><Timer className="me-1 inline h-3 w-3" />{dNum(Math.round(def.parMs / 1000))}s</span>
          </div>
          <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
            <p className="text-xs font-black text-rose-300">🧠 {t('cp_intel')} — {t('cp_tier')}: {t(`cp_tier_${def.catTier}` as never)}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-rose-200/70">{t(`cp_tier_desc_${def.catTier}` as never)}</p>
            <p className="mt-1.5 text-[11px] text-rose-200/70">
              {def.spawnEvery > 0
                ? <>⏱ {t('cp_spawn_every')} {dNum(Math.round(def.spawnEvery / 1000))} {t('cp_spawn_sec')}</>
                : t('cp_all_at_start')}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <CharPreview code={selChar.code} size={56} />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('cp_selected_char')}</p>
              <p className="font-black">{charName(selChar, locale)}</p>
            </div>
          </div>
          <span className="rounded-lg px-2 py-1 text-xs font-bold" style={{ backgroundColor: `${pal.accent}30`, color: pal.wall }}>
            {t(`cp_theme_${def.theme}` as never)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => { sfx.click(); setScreen('levels'); }}>{t('cp_to_map')}</Button>
          <Button className="glow-gold h-11 text-base" onClick={deploy}>
            <Play className="me-1.5 h-5 w-5" /> {t('cp_start')}
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------- game ----------------------------- */
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center gap-1.5 px-2 py-2" dir={rtl ? 'rtl' : 'ltr'}>
      {/* top HUD */}
      <div className="flex w-full max-w-xl items-center gap-2 rounded-2xl border border-amber-500/20 bg-black/40 px-3 py-2">
        <span className="flex items-center gap-1 text-sm font-black text-amber-300">
          <Cheese className="h-4 w-4" /> {dNum(hud?.cheese ?? 0)}/{dNum(hud?.cheeseTotal ?? 0)}
        </span>
        {(save.role === 'mouse') && hud && (
          <span className={`relative flex h-16 w-2 flex-col-reverse overflow-hidden rounded-full border border-white/15 bg-black/60 sm:h-20`} title={t('cp_sprint')}>
            <span
              className="absolute bottom-0 w-full rounded-full transition-all"
              style={{ height: `${hud.stamina}%`, backgroundColor: hud.stamina < 25 ? '#f87171' : '#34d399' }}
            />
          </span>
        )}
        <span className={`flex items-center gap-1 text-sm font-black ${hud && hud.timeLeft < 15 ? 'text-rose-400' : 'text-foreground'}`}>
          <Clock className="h-4 w-4" /> {dNum(hud?.timeLeft ?? 0)}
        </span>
        {hud?.danger && <span className="animate-pulse rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-300">⚠ {t('cp_cat_close')}</span>}
        {hud?.open && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-300">🕳 {t('cp_burrow_open')}</span>}
        <span className="ms-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-200 hover:bg-white/10" aria-label={t('cp_paused')} onClick={() => pauseRef.current()}>
            <Pause className="h-4 w-4" />
          </Button>
          <span className="text-end">
            <span className="block text-[9px] uppercase tracking-wide text-amber-200/60">{t('score')}</span>
            <span className="gold-text block text-lg font-black leading-none">{dNum(hud?.score ?? 0)}</span>
          </span>
        </span>
      </div>

      {/* arena */}
      <div
        className="relative mx-auto w-full touch-none select-none"
        style={{ aspectRatio: `${buildLevel(selLevel).cols} / ${buildLevel(selLevel).rows}`, width: portrait ? 'min(100%, calc(52dvh * var(--cp-ratio)))' : undefined, ['--cp-ratio' as string]: `${buildLevel(selLevel).cols / buildLevel(selLevel).rows}` }}
        role="application"
        aria-label={`${t('game_cheese')} — ${t('game_cheese_tag')}`}
      >
        <canvas
          key={runKey}
          ref={canvasRef}
          className="absolute inset-0 h-full w-full rounded-2xl border border-amber-500/30 bg-[#171310]"
          style={{ touchAction: 'none' }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* landscape floating touch controls */}
        {hasTouch && !portrait && phase === 'playing' && (
          <>
            <div
              role="application"
              aria-label={t('cp_touch_hint')}
              className="absolute bottom-3 start-3 z-20 grid h-[92px] w-[92px] touch-none place-items-center rounded-full border-2 border-white/15 bg-black/40 text-white/50 backdrop-blur-sm"
              onPointerDown={onPadDown}
              onPointerMove={onPadMove}
              onPointerUp={onPadUp}
              onPointerCancel={onPadUp}
            >
              <span className="h-10 w-10 rounded-full border border-white/20 bg-white/10" />
            </div>
            <button
              type="button"
              aria-label={t('cp_sprint')}
              className="absolute bottom-4 end-4 z-20 grid h-[64px] w-[64px] touch-none select-none place-items-center rounded-full border-2 border-emerald-400/70 bg-emerald-500/25 text-emerald-100 shadow-lg shadow-black/50 backdrop-blur-sm active:bg-emerald-500/60"
              onPointerDown={(e) => { e.preventDefault(); sprintBtnRef.current = true; }}
              onPointerUp={() => { sprintBtnRef.current = false; }}
              onPointerCancel={() => { sprintBtnRef.current = false; }}
              onPointerLeave={() => { sprintBtnRef.current = false; }}
            >
              <Flame className="h-7 w-7" fill="currentColor" />
            </button>
          </>
        )}

        {/* banner */}
        {banner && phase === 'banner' && (
          <div key={banner.key} className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
            <div className="text-center">
              <div className={`text-2xl font-black drop-shadow-[0_0_18px_rgba(251,191,36,0.6)] sm:text-3xl ${banner.danger ? 'text-rose-400' : 'gold-text'}`}>{banner.text}</div>
              {banner.sub && <div className="mt-1 text-sm font-bold text-amber-200/80">{banner.sub}</div>}
            </div>
          </div>
        )}

        {/* pause overlay */}
        {phase === 'paused' && (
          <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-black/70 backdrop-blur-sm">
            <div className="animate-pop w-full max-w-[280px] space-y-3 rounded-2xl border border-amber-500/25 bg-[#14100c]/95 p-5 text-center">
              <Pause className="mx-auto h-8 w-8 text-amber-400" />
              <p className="text-lg font-black text-amber-100">{t('cp_paused')}</p>
              <div className="grid gap-2">
                <Button className="glow-gold" onClick={() => pauseRef.current()}>
                  <Play className="me-1 h-4 w-4" /> {t('cp_resume')}
                </Button>
                <Button variant="outline" onClick={retry}>{t('cp_restart')}</Button>
                <Button variant="outline" onClick={toMap}>{t('cp_quit')}</Button>
              </div>
            </div>
          </div>
        )}

        {/* result panel */}
        {result && (phase === 'won' || phase === 'lost') && (
          <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto rounded-2xl bg-black/75 p-3 backdrop-blur-sm">
            <div className={`animate-pop w-full max-w-[340px] space-y-3 rounded-2xl border p-5 text-center ${result.r.won ? 'border-emerald-500/30 bg-[#14100c]/95' : 'border-rose-500/30 bg-[#14100c]/95'}`}>
              {result.r.won ? (
                <>
                  <p className="text-3xl">{save.role === 'mouse' ? '🧀' : '🎉'}</p>
                  <h3 className="gold-text text-xl font-black">{save.role === 'mouse' ? t('cp_win_title') : t('cp_win_cat_title')}</h3>
                  <CelebrationSprite code={useApp.getState().user?.celebrationPack ?? 'celeb_confetti'} size={72} dancing={!useApp.getState().perfMode} />
                </>
              ) : (
                <>
                  <p className="text-3xl">{result.r.reason === 'time' ? '⌛' : result.r.reason === 'escaped' ? '🕳️' : '💥'}</p>
                  <h3 className="text-xl font-black text-rose-300">
                    {result.r.reason === 'time' ? t('cp_lose_time') : result.r.reason === 'escaped' ? t('cp_lose_escaped') : t('cp_lose_caught')}
                  </h3>
                </>
              )}
              {result.r.won && starsRow(result.stars)}
              <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <span>🧀 {dNum(result.r.cheese)}/{dNum(hud?.cheeseTotal ?? buildLevel(selLevel).cheese)}</span>
                <span>⏱ {dNum(Math.round(result.r.timeMs / 1000))}s</span>
              </div>
              {result.rewards && (
                <p className="text-[11px] font-bold text-amber-300">
                  {t('cp_platform_rewards')}: +{dNum(result.rewards.coins)} 🪙 · +{dNum(result.rewards.xp)} ✦
                </p>
              )}
              {!result.rewards && !useApp.getState().user && <p className="text-[10px] text-muted-foreground">{t('cp_guest_local')}</p>}
              <div className="grid gap-2 pt-1">
                {result.r.won && selLevel < 30 && isLevelUnlocked(save, selLevel + 1) && (
                  <Button
                    className="glow-gold bg-amber-600 text-white hover:bg-amber-500"
                    onClick={() => { setSelLevel(selLevel + 1); setResult(null); setBanner(null); setHud(null); setPhase('banner'); setRunKey((k) => k + 1); sfx.click(); }}
                  >
                    {t('cp_next_level')} <Play className="ms-1 h-4 w-4" />
                  </Button>
                )}
                <Button variant="outline" onClick={retry}>{t('cp_retry')}</Button>
                <Button variant="outline" onClick={toMap}>{t('cp_to_map')}</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* portrait touch deck (pinned like TinkTank) */}
      {portrait && phase === 'playing' && (
        <div className="mx-auto mt-auto flex w-full max-w-[420px] select-none items-end justify-between gap-3 px-3 pb-1 pt-3" style={{ touchAction: 'none' }}>
          <div
            ref={padRef}
            role="application"
            aria-label={t('cp_touch_hint')}
            className="relative grid h-[112px] w-[112px] touch-none place-items-center rounded-full border-2 border-white/15 bg-white/5 text-white/50 shadow-lg shadow-black/40"
            onPointerDown={onPadDown}
            onPointerMove={onPadMove}
            onPointerUp={onPadUp}
            onPointerCancel={onPadUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="h-12 w-12 rounded-full border border-white/20 bg-white/10" />
            <span className="absolute bottom-1.5 text-[9px] font-bold tracking-widest">{t('cp_hud_left')}</span>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              aria-label={t('cp_sprint')}
              className="grid h-[72px] w-[72px] touch-none select-none place-items-center rounded-full border-2 border-emerald-400/70 bg-emerald-500/25 text-emerald-100 shadow-lg shadow-black/50 active:bg-emerald-500/60"
              onPointerDown={(e) => { e.preventDefault(); sprintBtnRef.current = true; }}
              onPointerUp={() => { sprintBtnRef.current = false; }}
              onPointerCancel={() => { sprintBtnRef.current = false; }}
              onPointerLeave={() => { sprintBtnRef.current = false; }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Flame className="h-8 w-8" fill="currentColor" />
            </button>
          </div>
        </div>
      )}

      <p className="mt-1 text-center text-[10px] text-muted-foreground">
        <span className="hidden sm:inline">{t('cp_keys_hint')}</span>
        <span className="sm:hidden">{t('cp_touch_hint')}</span>
      </p>
    </div>
  );
}

/* ====================== character preview (shared) ===================== */

function CharPreview({ code, size = 72 }: { code: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ch = CHAR_BY_CODE[code];
    if (!ch) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2 + size * 0.06);
    drawCritter(ctx, ch.species, 0, 0, size * 0.3, {
      pal: ch.palette, hat: ch.hat, hatColor: ch.hatColor,
      walkT: 0.25, tailT: 0.4, mood: 'happy', blink: false,
    });
    ctx.restore();
  }, [code, size]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-xl border border-white/10 bg-gradient-to-b from-white/10 to-transparent"
      aria-hidden
    />
  );
}

/* ============================ loop-path helper ========================= */
/** A* that avoids one cell — used by the FLANKER to take the loop route. */
function loopPath(m: Maze, from: { c: number; r: number }, to: { c: number; r: number }, avoid: { c: number; r: number }): { c: number; r: number }[] {
  if (avoid.c < 0 || avoid.r < 0 || avoid.c >= m.cols || avoid.r >= m.rows) return astarPath(m, from.c, from.r, to.c, to.r);
  const keep = m.grid[avoid.r * m.cols + avoid.c];
  m.grid[avoid.r * m.cols + avoid.c] = 1;
  const p = astarPath(m, from.c, from.r, to.c, to.r);
  m.grid[avoid.r * m.cols + avoid.c] = keep;
  if (p.length === 0) return astarPath(m, from.c, from.r, to.c, to.r);
  return p;
}

/* ============================== renderer =============================== */

function render(
  g: Game, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, dpr: number,
  def: LevelDef, lay: LevelLayout, lowFx: boolean, gTime: number,
): void {
  const maze = lay.maze;
  const W = maze.cols * CELL;
  const H = maze.rows * CELL;
  const scale = canvas.width / (W * dpr);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  /* screen shake */
  if (g.shake > 0) {
    const s = g.shake * 7;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  const pal = THEME_PALETTES[def.theme];

  /* floor */
  ctx.fillStyle = pal.floor;
  ctx.fillRect(0, 0, W, H);
  if (!lowFx) {
    ctx.fillStyle = pal.floorDot;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        if (maze.grid[r * maze.cols + c] === 0 && (r + c) % 2 === 0) {
          ctx.fillRect(c * CELL + CELL * 0.46, r * CELL + CELL * 0.46, CELL * 0.08, CELL * 0.08);
        }
      }
    }
  }

  /* burrow */
  const bx = lay.burrow.c * CELL + CELL / 2;
  const by = lay.burrow.r * CELL + CELL / 2;
  ctx.save();
  ctx.translate(bx, by);
  const pulse = g.burrowOpen ? 1 + Math.sin(gTime / 180) * 0.12 : 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, CELL * 0.42 * pulse, CELL * 0.3 * pulse, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#17110c';
  ctx.fill();
  ctx.strokeStyle = g.burrowOpen ? '#34d399' : 'rgba(120,90,60,0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (g.burrowOpen && !lowFx) {
    ctx.beginPath();
    ctx.ellipse(0, 0, CELL * 0.6, CELL * 0.45, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(52,211,153,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  /* cheese */
  for (const ch of g.cheese) {
    if (ch.taken) continue;
    drawCheese(ctx, ch.c * CELL + CELL / 2, ch.r * CELL + CELL / 2, CELL * 0.2, ch.sparkT, !lowFx);
  }

  /* walls */
  for (let r = 0; r < maze.rows; r++) {
    for (let c = 0; c < maze.cols; c++) {
      if (maze.grid[r * maze.cols + c] === 1) {
        hatchWall(ctx, c * CELL, r * CELL, CELL, pal, r * 131 + c, !lowFx);
      }
    }
  }

  /* ————— actors ————— */
  const drawActor = (a: Actor, isMouse: boolean, winPull: boolean) => {
    const x = a.x * CELL;
    const y = a.y * CELL;
    const r = CELL * 0.34;
    const faceSign = Math.cos(a.ang) < -0.08 ? -1 : 1;
    ctx.save();
    if (a.spawnT > 0) {
      ctx.globalAlpha = 1 - a.spawnT / SPAWN_FADE;
      ctx.translate(x, y);
      ctx.scale(1 + (a.spawnT / SPAWN_FADE) * 0.6, 1 + (a.spawnT / SPAWN_FADE) * 0.6);
      ctx.translate(-x, -y);
    }
    if (winPull) {
      const k = clamp(1 - g.winT / 950, 0, 1);
      ctx.translate(x, y);
      ctx.rotate(k * Math.PI * 2.5);
      const sc = Math.max(0.05, 1 - k);
      ctx.scale(sc, sc);
      ctx.translate(-x, -y);
    }
    /* shadow */
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,12,6,0.25)';
    ctx.fill();

    drawCritter(ctx, a.species, x, y, r, {
      pal: a.pal, hat: a.hat, hatColor: a.hatColor,
      walkT: a.walkT, tailT: a.fx, mood: a.mood,
      blink: a.blinkT < 0, sprint: false, hue: faceSign,
    });
    ctx.restore();
  };

  /* hunters first (mouse drawn above) */
  const focus = g.role === 'mouse' ? g.mouse : (g.player ?? g.mouse);
  for (const h of g.hunters) drawActor(h, false, false);
  if (g.player) drawActor(g.player, false, false);
  drawActor(g.mouse, true, g.phase === 'won' && g.winT > 0);

  /* shared blackboard debug ring (subtle): predicted position on T3+ */
  if (!lowFx && g.brain.predicted && (g.brain.tier >= 3)) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(g.brain.predicted.x * CELL, g.brain.predicted.y * CELL, CELL * 0.28, 0, Math.PI * 2);
    ctx.strokeStyle = '#f87171';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /* particles */
  for (const p of g.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    if (p.conf) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin + p.life / 120);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  /* score popups */
  for (const p of g.pops) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `900 ${CELL * 0.34}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = p.c;
    ctx.strokeStyle = 'rgba(20,12,6,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(p.txt, p.x, p.y);
    ctx.fillText(p.txt, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  /* warm lamp lighting + vignette (focus = player or the mouse) */
  if (!lowFx) {
    const fx = focus.x * CELL;
    const fy = focus.y * CELL;
    const lamp = ctx.createRadialGradient(fx, fy, CELL * 0.5, fx, fy, CELL * 4.6);
    lamp.addColorStop(0, 'rgba(255,205,130,0.14)');
    lamp.addColorStop(0.5, 'rgba(255,190,110,0.05)');
    lamp.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);
    const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(10,6,2,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  /* catch flash */
  if (g.flash > 0) {
    ctx.fillStyle = `rgba(220,60,60,${g.flash * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
}
