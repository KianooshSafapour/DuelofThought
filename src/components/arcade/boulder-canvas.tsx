'use client';

/**
 * Boulder Yard — full canvas scene renderer (R12-b graphics overhaul).
 *
 * One <canvas> draws the ENTIRE playfield; the DOM keeps only HUD, d-pad and
 * ability buttons. Layers per frame:
 *   cached terrain (theme strata / metal plates + ambient occlusion + decals)
 *   → target pulses → pit-fill patches → open pits → slide trails → boulders
 *   → machine (treads/wheels, headlight cone, blade/bucket/arm, cargo)
 *   → light pool → particles (dust/smoke/dirt/glints) → popups → day/night tint.
 *
 * Juice: 110 ms ease movement tween, push squash + resistance wobble, screen
 * shake for heavy machines, exhaust puffs, chain "×N" popups, level-complete
 * slow zoom + star burst. perfMode: DPR cap 1, particle budget, no shake.
 * Rendering only — every rule stays in boulder-engine.ts; this canvas is a
 * pure projection of the engine state (diffs trigger animations, never moves).
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { BoulderGameState, Dir } from '@/lib/game/boulder-engine';

export type BoulderTheme = 'quarry' | 'factory';

/** imperative one-shot effects the game shell can fire */
export interface BoulderCanvasApi {
  /** push hit a wall/immovable boulder — resistance wobble */
  bump: (dir: Dir) => void;
  /** floating text (chain ×N, +3★) at the machine */
  popup: (text: string, big?: boolean) => void;
  /** level complete: slow zoom + star burst with radial glints */
  burst: () => void;
}

export interface BoulderCanvasProps {
  game: BoulderGameState;
  theme: BoulderTheme;
  hue: number;
  kind: string;
  machineScale: number;
  cargo: boolean;
  perf: boolean;
  tile: number;
  /** 0 morning · 1 midday · 2 dusk/night (per yard group) */
  yardGroup: number;
  levelIndex: number;
  apiRef: RefObject<BoulderCanvasApi | null>;
}

/* ============================== helpers ============================== */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

const DIR_ANGLE: Record<Dir, number> = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };
const UNIT: Record<Dir, { x: number; y: number }> = { R: { x: 1, y: 0 }, L: { x: -1, y: 0 }, D: { x: 0, y: 1 }, U: { x: 0, y: -1 } };

function dvOf(dir: Dir, cols: number): number {
  return dir === 'U' ? -cols : dir === 'D' ? cols : dir === 'L' ? -1 : 1;
}

function easeOutCubic(p: number): number { const q = 1 - p; return 1 - q * q * q; }

function angleTo(cur: number, target: number, t: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * t;
}

/* ============================== world ============================== */

interface Anim { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; kind: 'slide' | 'swallow' | 'drop' }
interface BoulderR { cell: number; rx: number; ry: number; scale: number; alpha: number; anim: Anim | null; squashT: number; dead: boolean; trail: { x: number; y: number; t: number }[] }
interface Particle { kind: 'dust' | 'smoke' | 'dirt' | 'glint' | 'star'; x: number; y: number; vx: number; vy: number; g: number; t0: number; life: number; size: number; rot: number; hue: number }
interface Popup { text: string; x: number; y: number; t0: number; big: boolean }

interface World {
  levelKey: string;
  game: BoulderGameState | null;
  tile: number;
  boulders: BoulderR[];
  player: {
    cell: number; rx: number; ry: number; facing: Dir; angle: number;
    anim: Anim | null; treads: number; wheels: number; squashT: number; lastTrail: number;
  };
  particles: Particle[];
  popups: Popup[];
  fills: Map<number, number>;
  dig: { cell: number; t0: number } | null;
  cable: { cell: number; t0: number } | null;
  bump: { dir: Dir; t0: number } | null;
  shakeAmp: number;
  zoomT: number;
  lastFrame: number;
}

function freshWorld(): World {
  return {
    levelKey: '',
    game: null,
    tile: 40,
    boulders: [],
    player: { cell: 0, rx: 0, ry: 0, facing: 'D', angle: Math.PI / 2, anim: null, treads: 0, wheels: 0, squashT: 0, lastTrail: 0 },
    particles: [],
    popups: [],
    fills: new Map(),
    dig: null,
    cable: null,
    bump: null,
    shakeAmp: 0,
    zoomT: 0,
    lastFrame: 0,
  };
}

function spawnParticles(w: World, kind: Particle['kind'], x: number, y: number, n: number, tile: number) {
  for (let i = 0; i < n; i++) {
    if (w.particles.length >= 220) w.particles.shift();
    const a = Math.random() * Math.PI * 2;
    const sp = (0.4 + Math.random() * 1.2) * tile * 2.2;
    w.particles.push({
      kind,
      x, y,
      vx: Math.cos(a) * sp * (kind === 'glint' || kind === 'star' ? 1.6 : 0.5),
      vy: Math.sin(a) * sp * (kind === 'glint' || kind === 'star' ? 1.6 : 0.5) - (kind === 'dirt' ? tile * 3 : kind === 'smoke' ? tile * 0.6 : 0),
      g: kind === 'dirt' ? tile * 14 : kind === 'star' ? tile * 4 : 0,
      t0: performance.now(),
      life: kind === 'dust' ? 420 : kind === 'smoke' ? 700 : kind === 'dirt' ? 620 : kind === 'glint' ? 800 : 900,
      size: kind === 'glint' ? tile * 0.9 : tile * (0.08 + Math.random() * 0.12),
      rot: Math.random() * Math.PI * 2,
      hue: 40 + Math.random() * 20,
    });
  }
}

function popupAt(w: World, text: string, big: boolean) {
  w.popups.push({ text, x: (w.player.rx + 0.5) * w.tile, y: w.player.ry * w.tile - 4, t0: performance.now(), big });
  if (w.popups.length > 6) w.popups.shift();
}

/* ============================== component ============================== */

export function BoulderCanvas({ game, theme, hue, kind, machineScale, cargo, perf, tile, yardGroup, levelIndex, apiRef }: BoulderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W = useRef<World>(freshWorld());
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const terrainKey = useRef('');
  const propsRef = useRef<FrameProps>({ theme, hue, kind, machineScale, cargo, perf, tile, yardGroup });
  /* keep the RAF loop's view of the props fresh (runs before the diff effect) */
  useEffect(() => {
    propsRef.current = { theme, hue, kind, machineScale, cargo, perf, tile, yardGroup };
  });

  const resetWorld = (g: BoulderGameState) => {
    const w = W.current;
    w.levelKey = `${g.levelIndex}:${g.cols}x${g.rows}`;
    w.game = g;
    w.tile = tile;
    const bs = [...g.boulders].sort((a, b) => a - b);
    w.boulders = bs.map((cell) => ({ cell, rx: cell % g.cols, ry: Math.floor(cell / g.cols), scale: 1, alpha: 1, anim: null, squashT: 0, dead: false, trail: [] }));
    w.player = {
      cell: g.player, rx: g.player % g.cols, ry: Math.floor(g.player / g.cols),
      facing: g.facing, angle: DIR_ANGLE[g.facing], anim: null, treads: 0, wheels: 0,
      squashT: 0, lastTrail: 0,
    };
    w.particles = []; w.popups = []; w.fills = new Map();
    w.dig = null; w.cable = null; w.bump = null; w.shakeAmp = 0; w.zoomT = 0;
  };

  /* ---------- engine-state diff → animations ---------- */
  useEffect(() => {
    const w = W.current;
    const key = `${game.levelIndex}:${game.cols}x${game.rows}`;
    const prev = w.game;
    if (w.levelKey !== key || !prev || prev.levelIndex !== game.levelIndex || game.moves < prev.moves) {
      resetWorld(game); // new level / undo / restart
      return;
    }
    w.game = game;
    w.tile = tile;
    const now = performance.now();
    const cols = game.cols;
    const cellXY = (c: number) => ({ x: c % cols, y: Math.floor(c / cols) });

    /* --- player movement --- */
    let moveDir: Dir | null = null;
    if (prev.player !== game.player) {
      const dv = game.player - prev.player;
      moveDir = dv === cols ? 'D' : dv === -cols ? 'U' : dv === 1 ? 'R' : 'L';
      const to = cellXY(game.player);
      w.player.anim = { fx: w.player.rx, fy: w.player.ry, tx: to.x, ty: to.y, t0: now, dur: 110, kind: 'slide' };
      w.player.facing = moveDir;
      w.player.cell = game.player;
    }

    const pushed = game.pushes > prev.pushes;
    const pitFilled: number[] = [];
    for (const p of prev.pits) if (!game.pits.has(p)) pitFilled.push(p);

    const slides: { from: number; to: number }[] = [];
    const removed: number[] = [];
    for (const b of prev.boulders) {
      if (game.boulders.has(b)) continue;
      if (moveDir && game.boulders.has(b + dvOf(moveDir, cols))) slides.push({ from: b, to: b + dvOf(moveDir, cols) });
      else removed.push(b);
    }
    const added: number[] = [];
    for (const b of game.boulders) if (!prev.boulders.has(b)) added.push(b);

    if (pushed) {
      for (const s of slides) {
        const b = w.boulders.find((x) => x.cell === s.from && !x.dead);
        if (!b) continue;
        const to = cellXY(s.to);
        b.anim = { fx: b.rx, fy: b.ry, tx: to.x, ty: to.y, t0: now, dur: 110, kind: 'slide' };
        b.cell = s.to;
        b.squashT = now;
      }
      /* front boulder swallowed by a pit */
      const sw = pitFilled[0];
      if (sw !== undefined && moveDir) {
        const origin = sw - dvOf(moveDir, cols);
        const b = w.boulders.find((x) => !x.dead && x.cell === origin)
          ?? w.boulders.find((x) => !x.dead && !game.boulders.has(x.cell) && !slides.some((s) => s.from === x.cell));
        if (b) {
          const to = cellXY(sw);
          b.anim = { fx: b.rx, fy: b.ry, tx: to.x, ty: to.y, t0: now, dur: 170, kind: 'swallow' };
          b.cell = sw;
        }
      }
      /* machine squash + dust burst + shake for heavy machines */
      w.player.squashT = now;
      w.shakeAmp = perf ? 0 : Math.max(w.shakeAmp, propsRef.current.machineScale >= 1.06 ? 4.2 : 1.8);
      const front = slides.length > 0 ? slides[slides.length - 1] : null;
      if (front) {
        const f = cellXY(front.to);
        spawnParticles(w, 'dust', (f.x + 0.5) * tile, (f.y + 0.5) * tile, perf ? 3 : 7, tile);
      }
      if (slides.length > 1) popupAt(w, `×${slides.length}`, true);
    } else if (moveDir) {
      /* plain walk: light exhaust puff */
      spawnParticles(w, 'smoke', (w.player.rx + 0.5) * tile, (w.player.ry + 0.5) * tile, perf ? 1 : 2, tile);
    }

    /* --- grab: boulder removed ahead, player stayed put, no pit filled --- */
    if (!pushed && removed.length > 0 && pitFilled.length === 0 && prev.player === game.player) {
      const ahead = game.player - dvOf(game.facing, cols);
      const b = w.boulders.find((x) => !x.dead && !game.boulders.has(x.cell) && x.cell === ahead)
        ?? w.boulders.find((x) => !x.dead && !game.boulders.has(x.cell));
      if (b) {
        const to = cellXY(w.player.cell);
        b.anim = { fx: b.rx, fy: b.ry, tx: to.x, ty: to.y, t0: now, dur: 300, kind: 'swallow' };
        b.cell = w.player.cell;
        w.cable = { cell: b.cell, t0: now };
      }
    }

    /* --- dig: pit filled with no boulder involved --- */
    if (!pushed && pitFilled.length > 0 && removed.length === 0 && added.length === 0) {
      const cell = pitFilled[0];
      w.dig = { cell, t0: now };
      const c = cellXY(cell);
      spawnParticles(w, 'dirt', (c.x + 0.5) * tile, (c.y + 0.5) * tile, perf ? 5 : 12, tile);
    }

    /* --- every filled pit gets a dirt patch + splash --- */
    for (const p of pitFilled) {
      w.fills.set(p, now);
      const c = cellXY(p);
      spawnParticles(w, 'dirt', (c.x + 0.5) * tile, (c.y + 0.5) * tile, perf ? 3 : 6, tile);
    }

    /* --- drop: new boulder falls from the machine --- */
    for (const a of added) {
      const to = cellXY(a);
      const from = cellXY(w.player.cell);
      w.boulders.push({ cell: a, rx: from.x, ry: from.y, scale: 0.35, alpha: 1, anim: { fx: from.x, fy: from.y, tx: to.x, ty: to.y, t0: now, dur: 260, kind: 'drop' }, squashT: 0, dead: false, trail: [] });
    }

    /* --- keep the resting list in sync (safety for edge flows) --- */
    for (const b of w.boulders) if (!b.dead && !game.boulders.has(b.cell) && !b.anim) b.dead = true;
  }, [game, perf, tile]);

  /* ---------- imperative API ---------- */
  useEffect(() => {
    apiRef.current = {
      bump: (dir: Dir) => { W.current.bump = { dir, t0: performance.now() }; },
      popup: (text: string, big = false) => popupAt(W.current, text, big),
      burst: () => {
        const w = W.current;
        w.zoomT = performance.now();
        const cx = (w.player.rx + 0.5) * w.tile;
        const cy = (w.player.ry + 0.5) * w.tile;
        spawnParticles(w, 'star', cx, cy, perf ? 12 : 26, w.tile);
        if (!perf) spawnParticles(w, 'glint', cx, cy, 8, w.tile);
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, perf]);

  /* ---------- terrain cache (per level + tile size + theme) ---------- */
  useEffect(() => {
    const key = `${levelIndex}:${game.cols}x${game.rows}:${tile}:${theme}`;
    if (terrainKey.current === key || tile <= 0) return;
    terrainKey.current = key;
    const dpr = perf ? 1 : Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(game.cols * tile * dpr));
    cv.height = Math.max(1, Math.ceil(game.rows * tile * dpr));
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      drawTerrain(ctx, game, tile, theme);
    }
    terrainRef.current = cv;
  }, [game, tile, theme, levelIndex, perf]);

  /* ---------- RAF loop ---------- */
  useEffect(() => {
    let raf = 0;
    const drawFrame = (now: number) => {
      const cv = canvasRef.current;
      const w = W.current;
      const P = propsRef.current;
      if (cv && P.tile > 0 && w.game) {
        const dpr = P.perf ? 1 : Math.min(2, window.devicePixelRatio || 1);
        const cssW = w.game.cols * P.tile;
        const cssH = w.game.rows * P.tile;
        if (cv.width !== Math.ceil(cssW * dpr) || cv.height !== Math.ceil(cssH * dpr)) {
          cv.width = Math.ceil(cssW * dpr);
          cv.height = Math.ceil(cssH * dpr);
        }
        const ctx = cv.getContext('2d');
        if (ctx) render(ctx, w, terrainRef.current, P, cssW, cssH, dpr, now);
      }
      w.lastFrame = now;
      raf = requestAnimationFrame(drawFrame);
    };
    raf = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cssW = game.cols * tile;
  const cssH = game.rows * tile;

  return (
    <canvas
      ref={canvasRef}
      style={{ width: cssW, height: cssH }}
      className="block rounded-lg"
      aria-hidden
    />
  );
}

/* ============================== terrain (cached offscreen) ============================== */

function drawTerrain(ctx: CanvasRenderingContext2D, g: BoulderGameState, tile: number, theme: BoulderTheme) {
  const rnd = mulberry32(0xbe1a + g.levelIndex * 977 + g.cols * 31 + g.rows * 17);
  const cellHash = (i: number) => {
    const x = Math.imul(i + 0x9e37, 0x85ebca6b) >>> 0;
    return (x ^ (x >>> 13)) / 4294967296;
  };

  for (let r = 0; r < g.rows; r++) {
    const line = (g.def.ascii[r] ?? '').padEnd(g.cols, ' ');
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      const x = c * tile;
      const y = r * tile;
      const ch = line[c];
      if (ch === ' ') continue; // void stays transparent
      if (!g.wall[i]) {
        /* ---------------- floor ---------------- */
        if (theme === 'quarry') {
          const l = 38 + cellHash(i) * 9;
          ctx.fillStyle = `hsl(31 30% ${l}%)`;
          ctx.fillRect(x, y, tile, tile);
          /* layered stone strata */
          const bands = 3 + Math.floor(cellHash(i * 3) * 2);
          for (let b = 0; b < bands; b++) {
            const by = y + (b / bands) * tile + cellHash(i * 7 + b) * 3;
            const bh = tile / bands - 1;
            ctx.fillStyle = `hsla(${28 + b * 3} 26% ${l - 6 + b * 3}% / 0.5)`;
            ctx.fillRect(x, by, tile, bh);
          }
          /* gravel noise */
          for (let d = 0; d < 9; d++) {
            const gx = x + rnd() * tile;
            const gy = y + rnd() * tile;
            ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,244,214,0.14)' : 'rgba(41,26,12,0.16)';
            ctx.fillRect(gx, gy, 1.4, 1.4);
          }
          /* cracks */
          if (cellHash(i * 11) < 0.16) {
            ctx.strokeStyle = 'rgba(30,18,8,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            let px = x + tile * (0.2 + rnd() * 0.5);
            let py = y + tile * 0.15;
            ctx.moveTo(px, py);
            for (let s = 0; s < 3; s++) { px += (rnd() - 0.5) * tile * 0.3; py += tile * 0.28; ctx.lineTo(px, py); }
            ctx.stroke();
          }
        } else {
          /* factory: riveted metal plates */
          const l = 27 + cellHash(i) * 7;
          ctx.fillStyle = `hsl(210 9% ${l}%)`;
          ctx.fillRect(x, y, tile, tile);
          for (let d = 0; d < 4; d++) {
            ctx.fillStyle = 'rgba(255,255,255,0.045)';
            ctx.fillRect(x, y + rnd() * tile, tile, 1);
          }
          ctx.strokeStyle = 'rgba(8,12,18,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
          ctx.fillStyle = 'rgba(200,210,225,0.25)';
          for (const [ox, oy] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
            ctx.beginPath();
            ctx.arc(x + ox * tile, y + oy * tile, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
          /* oil stains */
          if (cellHash(i * 13) < 0.14) {
            ctx.fillStyle = 'rgba(10,10,14,0.24)';
            for (let d = 0; d < 3; d++) {
              ctx.beginPath();
              ctx.ellipse(x + tile * (0.3 + rnd() * 0.4), y + tile * (0.3 + rnd() * 0.4), tile * (0.1 + rnd() * 0.18), tile * (0.08 + rnd() * 0.14), rnd() * 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          /* faint hazard stripes on a few plates */
          if (cellHash(i * 17) < 0.05) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, tile, tile);
            ctx.clip();
            ctx.strokeStyle = 'rgba(251,191,36,0.10)';
            ctx.lineWidth = tile * 0.14;
            for (let s = -1; s < 5; s++) {
              ctx.beginPath();
              ctx.moveTo(x + s * tile * 0.35, y + tile);
              ctx.lineTo(x + s * tile * 0.35 + tile, y);
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        /* target pad base */
        if (g.targets.has(i)) {
          ctx.save();
          ctx.strokeStyle = 'rgba(52,211,153,0.75)';
          ctx.lineWidth = Math.max(1.5, tile * 0.06);
          ctx.setLineDash([tile * 0.14, tile * 0.1]);
          ctx.beginPath();
          ctx.arc(x + tile / 2, y + tile / 2, tile * 0.3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(52,211,153,0.12)';
          ctx.beginPath();
          ctx.arc(x + tile / 2, y + tile / 2, tile * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        /* one-way gate decal */
        const gate = g.gates.get(i);
        if (gate) {
          const rot = gate === 'R' ? 0 : gate === 'D' ? Math.PI / 2 : gate === 'L' ? Math.PI : -Math.PI / 2;
          ctx.save();
          ctx.translate(x + tile / 2, y + tile / 2);
          ctx.rotate(rot);
          ctx.fillStyle = theme === 'factory' ? 'rgba(56,189,248,0.28)' : 'rgba(120,113,108,0.35)';
          ctx.beginPath();
          ctx.moveTo(-tile * 0.16, -tile * 0.2);
          ctx.lineTo(tile * 0.22, 0);
          ctx.lineTo(-tile * 0.16, tile * 0.2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = theme === 'factory' ? 'rgba(125,211,252,0.6)' : 'rgba(214,211,209,0.5)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.restore();
        }
      } else {
        /* ---------------- walls ---------------- */
        if (theme === 'quarry') {
          const l = 20 + cellHash(i) * 6;
          ctx.fillStyle = `hsl(26 20% ${l}%)`;
          rr(ctx, x + 0.5, y + 0.5, tile - 1, tile - 1, tile * 0.12);
          ctx.fill();
          ctx.fillStyle = `hsla(32 26% ${l + 14}% / 0.9)`;
          rr(ctx, x + 1.5, y + 1.5, tile - 3, tile * 0.26, tile * 0.1);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + tile * 0.3, y + tile * 0.4);
          ctx.lineTo(x + tile * 0.55, y + tile * 0.62);
          ctx.lineTo(x + tile * 0.5, y + tile * 0.85);
          ctx.stroke();
        } else {
          const l = 15 + cellHash(i) * 5;
          ctx.fillStyle = `hsl(216 12% ${l}%)`;
          rr(ctx, x + 0.5, y + 0.5, tile - 1, tile - 1, tile * 0.08);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(x + 2, y + 1.5, tile - 4, 1.5);
          ctx.fillStyle = 'rgba(148,163,184,0.4)';
          for (const [ox, oy] of [[0.16, 0.2], [0.84, 0.2], [0.16, 0.82], [0.84, 0.82]]) {
            ctx.beginPath();
            ctx.arc(x + ox * tile, y + oy * tile, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 1, y + tile * 0.78, tile - 2, tile * 0.2);
          ctx.clip();
          ctx.strokeStyle = 'rgba(251,191,36,0.35)';
          ctx.lineWidth = 3;
          for (let s = -1; s < 6; s++) {
            ctx.beginPath();
            ctx.moveTo(x + s * 6, y + tile);
            ctx.lineTo(x + s * 6 + 6, y + tile * 0.72);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  }

  /* -------- ambient occlusion on floor next to walls/void -------- */
  for (let r = 0; r < g.rows; r++) {
    const line = (g.def.ascii[r] ?? '').padEnd(g.cols, ' ');
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (line[c] === ' ' || g.wall[i]) continue;
      const x = c * tile;
      const y = r * tile;
      const a = tile * 0.3;
      const solid = (ii: number) => ii >= 0 && ii < g.rows * g.cols && g.wall[ii];
      if (solid(i - g.cols)) {
        const grad = ctx.createLinearGradient(0, y, 0, y + a);
        grad.addColorStop(0, 'rgba(0,0,0,0.34)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, tile, a);
      }
      if (solid(i + g.cols)) {
        const grad = ctx.createLinearGradient(0, y + tile, 0, y + tile - a);
        grad.addColorStop(0, 'rgba(0,0,0,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y + tile - a, tile, a);
      }
      if (c > 0 && solid(i - 1)) {
        const grad = ctx.createLinearGradient(x, 0, x + a, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, a, tile);
      }
      if (c < g.cols - 1 && solid(i + 1)) {
        const grad = ctx.createLinearGradient(x + tile, 0, x + tile - a, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + tile - a, y, a, tile);
      }
    }
  }
}

/* ============================== per-frame render ============================== */

interface FrameProps { theme: BoulderTheme; hue: number; kind: string; machineScale: number; cargo: boolean; perf: boolean; tile: number; yardGroup: number }

function render(
  ctx: CanvasRenderingContext2D,
  w: World,
  terrain: HTMLCanvasElement | null,
  P: FrameProps,
  cssW: number,
  cssH: number,
  dpr: number,
  now: number,
) {
  const g = w.game;
  if (!g) return;
  const tile = P.tile;
  const dt = w.lastFrame ? Math.min(64, now - w.lastFrame) : 16;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  /* screen shake (heavy machines; skipped in perf mode) */
  if (w.shakeAmp > 0.1 && !P.perf) {
    ctx.translate((Math.random() - 0.5) * w.shakeAmp * 2, (Math.random() - 0.5) * w.shakeAmp * 2);
    w.shakeAmp *= Math.exp(-dt / 70);
  } else w.shakeAmp = 0;

  /* level-complete slow zoom */
  if (w.zoomT) {
    const p = Math.min(1, (now - w.zoomT) / 900);
    const z = 1 + 0.055 * easeOutCubic(p);
    ctx.translate(cssW / 2, cssH / 2);
    ctx.scale(z, z);
    ctx.translate(-cssW / 2, -cssH / 2);
  }

  if (terrain) ctx.drawImage(terrain, 0, 0, cssW, cssH);

  /* target pulses */
  for (const tIdx of g.targets) {
    const tx = (tIdx % g.cols) * tile + tile / 2;
    const ty = Math.floor(tIdx / g.cols) * tile + tile / 2;
    const phase = (now / 1200 + tIdx * 0.35) % 1;
    const occupied = g.boulders.has(tIdx);
    ctx.beginPath();
    ctx.arc(tx, ty, tile * (0.2 + phase * 0.3), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(52,211,153,${(occupied ? 0.5 : 0.28) * (1 - phase)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (occupied) {
      ctx.beginPath();
      ctx.arc(tx, ty, tile * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(52,211,153,0.16)';
      ctx.fill();
    }
  }

  /* pit-fill patches (dirt mound fading out) */
  for (const [cell, t0] of w.fills) {
    const p = (now - t0) / 750;
    if (p >= 1) { w.fills.delete(cell); continue; }
    const x = (cell % g.cols) * tile;
    const y = Math.floor(cell / g.cols) * tile;
    ctx.fillStyle = P.theme === 'quarry'
      ? `hsla(31 30% ${40 + 8 * p}% / ${0.9 - 0.3 * p})`
      : `hsla(210 9% ${30 + 6 * p}% / ${0.9 - 0.3 * p})`;
    ctx.beginPath();
    ctx.arc(x + tile / 2, y + tile / 2, tile * 0.55 * easeOutCubic(Math.min(1, p * 1.6)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(94,62,28,${0.5 * (1 - p)})`;
    ctx.beginPath();
    ctx.arc(x + tile / 2, y + tile / 2, tile * 0.3 * (1 - p * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  /* open pits (dynamic — fillable) */
  for (const pit of g.pits) {
    const x = (pit % g.cols) * tile;
    const y = Math.floor(pit / g.cols) * tile;
    const cx = x + tile / 2;
    const cy = y + tile / 2;
    if (P.theme === 'factory') {
      ctx.strokeStyle = 'rgba(148,163,184,0.5)';
      ctx.lineWidth = 2;
      rr(ctx, x + tile * 0.1, y + tile * 0.1, tile * 0.8, tile * 0.8, tile * 0.12);
      ctx.stroke();
    }
    const grad = ctx.createRadialGradient(cx, cy, tile * 0.05, cx, cy, tile * 0.42);
    grad.addColorStop(0, 'rgba(0,0,0,0.96)');
    grad.addColorStop(0.7, 'rgba(5,4,10,0.85)');
    grad.addColorStop(1, 'rgba(20,16,28,0.35)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, tile * 0.4, tile * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---- boulders: animate + draw ---- */
  for (const b of w.boulders) {
    if (b.anim) {
      const a = b.anim;
      const p = Math.min(1, (now - a.t0) / a.dur);
      const e = easeOutCubic(p);
      b.rx = a.fx + (a.tx - a.fx) * e;
      b.ry = a.fy + (a.ty - a.fy) * e;
      if (a.kind === 'swallow') { b.scale = Math.max(0.05, 1 - p); b.alpha = 1 - p * 0.6; }
      if (a.kind === 'drop') {
        b.scale = 0.35 + 0.65 * e;
        b.ry = a.fy + (a.ty - a.fy) * e - Math.sin(Math.PI * p) * 0.5;
        if (p >= 1) spawnParticles(w, 'dust', (b.rx + 0.5) * tile, (b.ry + 0.7) * tile, P.perf ? 2 : 5, tile);
      }
      if (a.kind === 'slide' && now - w.player.lastTrail > 26) {
        b.trail.push({ x: b.rx, y: b.ry, t: now });
        w.player.lastTrail = now;
      }
      if (p >= 1) {
        if (a.kind === 'swallow') b.dead = true;
        b.anim = null;
        b.rx = a.tx; b.ry = a.ty; b.scale = 1; b.alpha = 1;
      }
    }
    b.trail = b.trail.filter((t) => now - t.t < 260);
    for (const t of b.trail) {
      const fade = 1 - (now - t.t) / 260;
      ctx.fillStyle = `rgba(168,162,158,${0.14 * fade})`;
      ctx.beginPath();
      ctx.arc((t.x + 0.5) * tile, (t.y + 0.5) * tile, tile * 0.3 * fade, 0, Math.PI * 2);
      ctx.fill();
    }
    if (b.dead) continue;
    drawBoulder(ctx, (b.rx + 0.5) * tile, (b.ry + 0.5) * tile, tile, b.cell, b.scale, b.alpha, g.targets.has(b.cell), b.squashT ? Math.max(0, 1 - (now - b.squashT) / 160) : 0);
  }
  w.boulders = w.boulders.filter((b) => !(b.dead && !b.anim));

  /* ---- machine ---- */
  const pl = w.player;
  if (pl.anim) {
    const a = pl.anim;
    const p = Math.min(1, (now - a.t0) / a.dur);
    const e = easeOutCubic(p);
    pl.rx = a.fx + (a.tx - a.fx) * e;
    pl.ry = a.fy + (a.ty - a.fy) * e;
    pl.treads += (tile / a.dur) * dt * 0.9;
    pl.wheels += ((tile / a.dur) * dt * 0.9) / (tile * 0.16);
    if (p >= 1) { pl.anim = null; pl.rx = a.tx; pl.ry = a.ty; }
  }
  pl.angle = angleTo(pl.angle, DIR_ANGLE[pl.facing], 1 - Math.exp(-dt / 60));

  const mx = (pl.rx + 0.5) * tile;
  const my = (pl.ry + 0.5) * tile;

  /* push-resistance wobble */
  let bumpX = 0, bumpY = 0;
  if (w.bump) {
    const bp = (now - w.bump.t0) / 180;
    if (bp >= 1) w.bump = null;
    else {
      const k = Math.sin(bp * Math.PI) * 0.16;
      const u = UNIT[w.bump.dir];
      bumpX = u.x * k * tile;
      bumpY = u.y * k * tile;
    }
  }
  const squash = Math.max(0, 1 - (now - pl.squashT) / 150);
  const night = P.yardGroup >= 2;

  /* headlight cone (under the body) */
  ctx.save();
  ctx.translate(mx + bumpX, my + bumpY);
  ctx.rotate(pl.angle);
  const coneLen = tile * 2.3;
  const cone = ctx.createLinearGradient(tile * 0.2, 0, coneLen, 0);
  cone.addColorStop(0, `rgba(255,236,180,${night ? 0.22 : 0.10})`);
  cone.addColorStop(1, 'rgba(255,236,180,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(tile * 0.28, -tile * 0.1);
  ctx.lineTo(coneLen, -tile * 0.42);
  ctx.lineTo(coneLen, tile * 0.42);
  ctx.lineTo(tile * 0.28, tile * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawMachine(ctx, mx + bumpX, my + bumpY, tile, pl.angle, pl.treads, pl.wheels, P, squash);
  if (P.cargo) {
    const bob = P.perf ? 0 : Math.sin(now / 240) * tile * 0.03;
    drawBoulder(ctx, mx + bumpX, my + bumpY - tile * 0.18 + bob, tile, 7919, 0.52, 1, false, 0);
  }

  /* dig arm */
  if (w.dig) {
    const p = (now - w.dig.t0) / 380;
    if (p >= 1) w.dig = null;
    else {
      const ext = Math.sin(Math.PI * p);
      const cx = (w.dig.cell % g.cols) * tile + tile / 2;
      const cy = Math.floor(w.dig.cell / g.cols) * tile + tile / 2;
      const jx = mx + (cx - mx) * 0.45 * ext;
      const jy = my + (cy - my) * 0.45 * ext;
      const ex = mx + (cx - mx) * 0.8 * ext;
      const ey = my + (cy - my) * 0.8 * ext;
      ctx.strokeStyle = `hsl(${P.hue} 45% 30%)`;
      ctx.lineWidth = tile * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(jx, jy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = '#a8a29e';
      rr(ctx, ex - tile * 0.1, ey - tile * 0.1, tile * 0.2, tile * 0.2, 2);
      ctx.fill();
    }
  }
  /* grab cable */
  if (w.cable) {
    const p = (now - w.cable.t0) / 300;
    if (p >= 1) w.cable = null;
    else {
      const cx = (w.cable.cell % g.cols) * tile + tile / 2;
      const cy = Math.floor(w.cable.cell / g.cols) * tile + tile / 2;
      const px = cx + (mx - cx) * easeOutCubic(p);
      const py = cy + (my - cy) * easeOutCubic(p);
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx, my - tile * 0.1);
      ctx.lineTo(px, py - tile * 0.1);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(px, py - tile * 0.1, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* dynamic light pool around the machine */
  const pool = ctx.createRadialGradient(mx, my, tile * 0.2, mx, my, tile * 2.4);
  pool.addColorStop(0, night ? 'rgba(255,214,140,0.20)' : 'rgba(255,224,160,0.10)');
  pool.addColorStop(1, 'rgba(255,224,160,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = pool;
  ctx.fillRect(mx - tile * 2.4, my - tile * 2.4, tile * 4.8, tile * 4.8);
  ctx.restore();

  drawParticles(ctx, w, tile, now, P.perf);

  /* popups */
  w.popups = w.popups.filter((pp) => now - pp.t0 < 950);
  for (const pp of w.popups) {
    const p = (now - pp.t0) / 950;
    const rise = easeOutCubic(p) * tile * 0.9;
    ctx.save();
    ctx.globalAlpha = p < 0.15 ? p / 0.15 : 1 - Math.max(0, (p - 0.55) / 0.45);
    ctx.font = `900 ${pp.big ? tile * 0.62 : tile * 0.44}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(pp.text, pp.x, pp.y - rise);
    ctx.fillStyle = pp.big ? '#fbbf24' : '#f8fafc';
    ctx.fillText(pp.text, pp.x, pp.y - rise);
    ctx.restore();
  }

  /* day/night tint per yard group + vignette */
  let tint: string;
  if (P.yardGroup === 0) tint = P.theme === 'quarry' ? 'rgba(255,196,120,0.06)' : 'rgba(160,196,255,0.05)';
  else if (P.yardGroup === 1) tint = 'rgba(200,220,255,0.02)';
  else tint = P.theme === 'quarry' ? 'rgba(38,48,110,0.20)' : 'rgba(30,40,90,0.24)';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, cssW, cssH);
  const vig = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, night ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, cssW, cssH);
}

/* ============================== boulder sprite ============================== */

function drawBoulder(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, tile: number, seed: number,
  scale: number, alpha: number, onTarget: boolean, squash: number,
) {
  const rnd = mulberry32(seed * 2654435761 + 11);
  const r = tile * 0.36;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (squash > 0) ctx.scale(1 + 0.14 * squash, 1 - 0.12 * squash);
  ctx.scale(scale, scale);
  /* shadow */
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.72, r * 0.85, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  if (onTarget) {
    ctx.fillStyle = 'rgba(52,211,153,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
  /* irregular rock silhouette */
  const pts: { x: number; y: number }[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const rr2 = r * (0.82 + rnd() * 0.3);
    pts.push({ x: Math.cos(a) * rr2, y: Math.sin(a) * rr2 });
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.15);
  grad.addColorStop(0, '#e7e5e4');
  grad.addColorStop(0.55, '#a8a29e');
  grad.addColorStop(1, '#57534e');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(41,37,36,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  /* speckles */
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc((rnd() - 0.5) * r * 1.1, (rnd() - 0.5) * r * 1.1, 1 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  /* shine */
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.26, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ============================== machine sprite (top view) ============================== */

function drawMachine(
  ctx: CanvasRenderingContext2D, mx: number, my: number, tile: number, angle: number,
  treads: number, wheels: number,
  P: FrameProps,
  squash: number,
) {
  const hue = P.hue;
  const body = `hsl(${hue} 62% 50%)`;
  const dark = `hsl(${hue} 58% 32%)`;
  const light = `hsl(${hue} 70% 62%)`;
  const glass = `hsl(${hue} 40% 82%)`;
  const s = P.machineScale;

  ctx.save();
  /* ground shadow */
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(mx + tile * 0.06, my + tile * 0.22, tile * 0.4 * s, tile * 0.26 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(mx, my);
  ctx.rotate(angle);
  if (squash > 0) ctx.scale(1 - 0.1 * squash, 1 + 0.06 * squash);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';

  const half = tile * 0.42;
  const tracked = P.kind === 'dozer' || P.kind === 'excavator';

  if (tracked) {
    /* rolling treads, rotation tied to movement */
    for (const side of [-1, 1]) {
      const ty = side * half * 0.62;
      ctx.fillStyle = '#1c1917';
      rr(ctx, -half * 0.92, ty - tile * 0.12, half * 1.84, tile * 0.24, tile * 0.1);
      ctx.fill();
      ctx.fillStyle = '#44403c';
      const gap = tile * 0.13;
      const off = treads % gap;
      for (let x = -half * 0.9 - gap + off; x < half * 0.9; x += gap) {
        ctx.fillRect(x, ty - tile * 0.09, tile * 0.09, tile * 0.18);
      }
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 1.5;
      rr(ctx, -half * 0.92, ty - tile * 0.12, half * 1.84, tile * 0.24, tile * 0.1);
      ctx.stroke();
    }
  } else {
    /* rolling wheels with rotating spokes */
    const wheelR = tile * 0.15;
    const spots: [number, number, number][] = P.kind === 'tractor'
      ? [[-half * 0.5, -half * 0.66, 1.25], [-half * 0.5, half * 0.66, 1.25], [half * 0.45, -half * 0.6, 0.85], [half * 0.45, half * 0.6, 0.85]]
      : P.kind === 'tractor_flat'
        ? [[-half * 0.55, -half * 0.62, 1], [-half * 0.05, -half * 0.62, 1], [-half * 0.55, half * 0.62, 1], [-half * 0.05, half * 0.62, 1], [half * 0.5, -half * 0.58, 1], [half * 0.5, half * 0.58, 1]]
        : [[-half * 0.5, -half * 0.64, 1], [-half * 0.5, half * 0.64, 1], [half * 0.5, -half * 0.64, 0.9], [half * 0.5, half * 0.64, 0.9]];
    for (const [wx, wy, ws] of spots) {
      ctx.save();
      ctx.translate(wx, wy);
      const wr = wheelR * ws;
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.arc(0, 0, wr, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(wheels);
      ctx.fillStyle = '#78716c';
      for (let k = 0; k < 3; k++) {
        ctx.rotate(Math.PI / 3);
        ctx.fillRect(-1.2, -wr, 2.4, wr * 2);
      }
      ctx.fillStyle = '#a8a29e';
      ctx.beginPath();
      ctx.arc(0, 0, wr * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* hull */
  const grad = ctx.createLinearGradient(0, -half * 0.6, 0, half * 0.6);
  grad.addColorStop(0, light);
  grad.addColorStop(0.55, body);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  if (P.kind === 'tractor') {
    rr(ctx, -half * 0.72, -half * 0.52, half * 1.5, half * 1.04, tile * 0.08);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.4;
    rr(ctx, -half * 0.72, -half * 0.52, half * 1.5, half * 1.04, tile * 0.08);
    ctx.stroke();
  } else if (P.kind === 'tractor_flat') {
    ctx.fillStyle = '#a8a29e';
    rr(ctx, -half * 0.9, -half * 0.44, half * 0.85, half * 0.88, tile * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(-half * 0.9 + (half * 0.85 * k) / 4, -half * 0.44);
      ctx.lineTo(-half * 0.9 + (half * 0.85 * k) / 4, half * 0.44);
      ctx.stroke();
    }
    ctx.fillStyle = grad;
    rr(ctx, half * 0.02, -half * 0.5, half * 0.78, half, tile * 0.07);
    ctx.fill();
  } else {
    rr(ctx, -half * 0.78, -half * 0.5, half * 1.42, half, tile * 0.1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.4;
    rr(ctx, -half * 0.78, -half * 0.5, half * 1.42, half, tile * 0.1);
    ctx.stroke();
  }

  /* cab glass */
  ctx.fillStyle = glass;
  rr(ctx, -half * 0.16, -half * 0.4, half * 0.62, half * 0.8, tile * 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.2;
  rr(ctx, -half * 0.16, -half * 0.4, half * 0.62, half * 0.8, tile * 0.06);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(-half * 0.1, half * 0.36);
  ctx.lineTo(half * 0.1, -half * 0.36);
  ctx.lineTo(half * 0.22, -half * 0.36);
  ctx.lineTo(-half * 0.02, half * 0.36);
  ctx.closePath();
  ctx.fill();

  /* front attachment per machine family */
  if (P.kind === 'dozer') {
    ctx.fillStyle = '#e2e8f0';
    rr(ctx, half * 0.66, -half * 0.72, tile * 0.1, half * 1.44, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(half * 0.66, -half * 0.72, tile * 0.03, half * 1.44);
    ctx.fillStyle = dark;
    ctx.fillRect(half * 0.5, -half * 0.5, half * 0.18, tile * 0.07);
    ctx.fillRect(half * 0.5, half * 0.36, half * 0.18, tile * 0.07);
  } else if (P.kind === 'loader') {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(half * 0.6, -half * 0.62);
    ctx.quadraticCurveTo(half * 1.05, 0, half * 0.6, half * 0.62);
    ctx.lineTo(half * 0.48, half * 0.5);
    ctx.quadraticCurveTo(half * 0.82, 0, half * 0.48, -half * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else if (P.kind === 'forklift') {
    ctx.fillStyle = '#78716c';
    ctx.fillRect(half * 0.6, -half * 0.34, tile * 0.05, half * 0.68);
    ctx.fillRect(half * 0.6, half * 0.1, half * 0.36, tile * 0.045);
    ctx.fillRect(half * 0.6, -half * 0.2, half * 0.36, tile * 0.045);
  } else if (P.kind === 'excavator') {
    ctx.strokeStyle = dark;
    ctx.lineWidth = tile * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-half * 0.2, half * 0.3);
    ctx.lineTo(half * 0.35, half * 0.55);
    ctx.lineTo(half * 0.8, half * 0.3);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    rr(ctx, half * 0.72, half * 0.14, tile * 0.14, tile * 0.14, 2);
    ctx.fill();
  } else {
    /* tractor: exhaust stack */
    ctx.fillStyle = '#57534e';
    ctx.beginPath();
    ctx.arc(-half * 0.58, -half * 0.3, tile * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  /* headlights */
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(half * 0.72, -half * 0.34, tile * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(half * 0.72, half * 0.34, tile * 0.045, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ============================== particles ============================== */

function drawParticles(ctx: CanvasRenderingContext2D, w: World, tile: number, now: number, perf: boolean) {
  const keep: Particle[] = [];
  for (const p of w.particles) {
    const age = (now - p.t0) / p.life;
    if (age >= 1) continue;
    keep.push(p);
    const x = p.x + p.vx * age * (p.life / 1000);
    const y = p.y + p.vy * age * (p.life / 1000) + p.g * age * age * 0.5 * (p.life / 1000) * (p.life / 1000);
    ctx.save();
    ctx.globalAlpha = 1 - age;
    if (p.kind === 'dust') {
      ctx.fillStyle = 'rgba(214,211,209,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 + age), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = 'rgba(82,82,91,0.4)';
      ctx.beginPath();
      ctx.arc(x, y - age * tile * 0.3, p.size * (1 + age * 1.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'dirt') {
      ctx.fillStyle = 'rgba(120,84,44,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, p.size * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'glint') {
      const len = p.size * (1 - age);
      ctx.strokeStyle = `hsla(${p.hue} 90% 70% / 0.9)`;
      ctx.lineWidth = 2;
      const rot = p.rot + age * 2.4;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(rot) * len, y - Math.sin(rot) * len);
      ctx.lineTo(x + Math.cos(rot) * len, y + Math.sin(rot) * len);
      ctx.stroke();
    } else {
      /* star burst particle */
      ctx.fillStyle = `hsl(${p.hue} 95% 65%)`;
      ctx.translate(x, y);
      ctx.rotate(p.rot + age * 3);
      const s2 = p.size * (1 - age * 0.5);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a1 = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const a2 = a1 + Math.PI / 5;
        ctx.lineTo(Math.cos(a1) * s2, Math.sin(a1) * s2);
        ctx.lineTo(Math.cos(a2) * s2 * 0.45, Math.sin(a2) * s2 * 0.45);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  w.particles = perf ? keep.slice(-60) : keep.slice(-220);
}
