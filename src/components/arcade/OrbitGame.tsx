'use client';

/**
 * Orbit Odyssey (ادیسهٔ مداری) — a REAL-orbital-mechanics puzzle campaign.
 * Physics: Newtonian gravity a = Σ GMᵢ(rᵢ−r)/|rᵢ−r|³, semi-implicit Euler @60 Hz,
 * identical integrator for the live aim-prediction and the actual flight (see
 * src/lib/game/orbit-missions.ts for tuning constants + beatability QA notes).
 *
 * Structure: campaign map → briefing → canvas play (aim ▸ launch ▸ coast/burn ▸ capture).
 * Economy: victory submits via useArcadeFinish('orbit'); losses stay local (score 0).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useApp } from '@/store/app';
import { localizeDigits } from '@/lib/i18n';
import { useArcadeFinish } from '@/lib/arcade-client';
import { sfx } from '@/lib/sound';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft, BookOpen, CheckCircle2, FlaskConical, Fuel, Lightbulb, Lock,
  RotateCcw, Target, Timer, Trophy,
} from 'lucide-react';
import {
  ACTS, CODEX, DT, FUEL_BURN, LAUNCH_FUEL_PER_DV, LAUNCH_SCALE, MAX_DRAG, MISSIONS,
  PREDICT_STEPS, POD_PICKUP, TIME_LIMIT, THRUST_ACCEL, WORLD, Mission, PredictResult,
  Bi, hitsBody, outOfBounds, pick, predictPath, stepProbe,
} from '@/lib/game/orbit-missions';

/* ============================================================ local strings */

const DRAG_HINT: Bi = { fa: 'برای پرتاب، بکش و رها کن', en: 'Drag & release to launch' };
const BURN_HINT: Bi = { fa: 'نگه‌دار و بکش تا موتور بسوزد', en: 'Hold & drag to burn' };
const COAST_HINT: Bi = { fa: 'سوخت تمام شد — سُرِ بالستیک', en: 'Fuel empty — ballistic coast' };
const NEW_BEST: Bi = { fa: 'رکورد جدید!', en: 'New best!' };
const FINALE: Bi = {
  fa: 'منارهٔ هلیوگراف دوباره می‌درخشد؛ چهار سال سکوت به پایان رسید و تارِ علمی بشر از نو زنده است. دستِ تو — و فیزیکِ خالص — شبکه را به خانه آورد.',
  en: 'The Heliograph beacon burns again; four years of silence are over and humanity\'s web of science is alive once more. Your hand — and pure physics — brought the network home.',
};
const TRY_AGAIN_TIP: Bi = { fa: 'هر بار پرتاب، مسیر را از نو پیش‌بینی می‌کنیم — دوباره تلاش کن!', en: 'Every launch re-plots the live prediction — try again!' };

/* ============================================================ canvas helpers */

interface Star { x: number; y: number; r: number; ph: number; sp: number; base: number }

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(seed: number): Star[] {
  const rng = mulberry32(seed * 7919 + 13);
  const stars: Star[] = [];
  for (let i = 0; i < 150; i++) stars.push({ x: rng() * WORLD.w, y: rng() * WORLD.h, r: 0.7 + rng() * 1.5, ph: rng() * Math.PI * 2, sp: 0.5 + rng() * 1.6, base: 0.22 + rng() * 0.4 });
  for (let i = 0; i < 55; i++) stars.push({ x: rng() * WORLD.w, y: rng() * WORLD.h, r: 1.7 + rng() * 1.9, ph: rng() * Math.PI * 2, sp: 0.4 + rng() * 1.1, base: 0.3 + rng() * 0.4 });
  return stars;
}

const NEBULAS = [
  { x: 330, y: 250, r: 500, c: '20,184,166', a: 0.1 },
  { x: 1290, y: 960, r: 540, c: '139,92,246', a: 0.08 },
  { x: 920, y: 520, r: 430, c: '245,158,11', a: 0.05 },
] as const;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number }

/* ============================================================ canvas component */

type Phase = 'aiming' | 'flight' | 'won' | 'crashed' | 'lost' | 'timeout';

interface Sim {
  phase: Phase;
  x: number; y: number; vx: number; vy: number;
  fuel: number; time: number; heading: number;
  trail: { x: number; y: number }[]; trailTick: number;
  pods: boolean[];
  thrusting: boolean; thrustingNow: boolean; aimX: number; aimY: number;
  drag: { sx: number; sy: number; cx: number; cy: number } | null;
  prediction: PredictResult | null; dv: number;
  particles: Particle[]; shake: number;
}

export interface HudSnap {
  phase: Phase;
  fuel: number; fuelMax: number;
  pods: number; podsTotal: number;
  timeLeft: number;
  dv: number; aiming: boolean; thrusting: boolean; coasting: boolean;
}

function initSim(m: Mission): Sim {
  return {
    phase: 'aiming', x: m.start.x, y: m.start.y, vx: 0, vy: 0,
    fuel: m.startFuel, time: 0, heading: 0,
    trail: [], trailTick: 0, pods: m.pods.map(() => false),
    thrusting: false, thrustingNow: false, aimX: m.start.x, aimY: m.start.y,
    drag: null, prediction: null, dv: 0, particles: [], shake: 0,
  };
}

/** Drag vector → capped, fuel-affordable launch Δv (pure; used by prediction & release). */
function aimDelta(s: Sim): { vx: number; vy: number; dv: number } {
  if (!s.drag) return { vx: 0, vy: 0, dv: 0 };
  const dx = (s.drag.cx - s.drag.sx) * LAUNCH_SCALE;
  const dy = (s.drag.cy - s.drag.sy) * LAUNCH_SCALE;
  const L = Math.hypot(dx, dy);
  const maxDv = Math.min(MAX_DRAG * LAUNCH_SCALE, s.fuel / LAUNCH_FUEL_PER_DV);
  const dv = Math.min(L, maxDv);
  if (L < 1e-6 || dv <= 0) return { vx: 0, vy: 0, dv: 0 };
  return { vx: (dx / L) * dv, vy: (dy / L) * dv, dv };
}

function drawSphere(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lx: number, ly: number, arcs: number, t: number): void {
  // soft glow
  ctx.save();
  ctx.shadowColor = hexA(color, 0.55);
  ctx.shadowBlur = 16;
  const g = ctx.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.12, x, y, r);
  g.addColorStop(0, shade(color, 0.55));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.62));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // rotating surface arcs (clip to sphere)
  if (arcs > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1.4, r * 0.06);
    for (let i = 0; i < arcs; i++) {
      const a0 = t * (0.14 + i * 0.05) * (i % 2 ? -1 : 1) + i * 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.4 + i * 0.26), a0, a0 + 1.9 + i * 0.4);
      ctx.stroke();
    }
    ctx.restore();
  }
  // rim light on the lit side
  const la = Math.atan2(ly, lx);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r - 1.1, la - 1.7, la + 1.7);
  ctx.stroke();
}

function drawRingedPlanet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lx: number, ly: number, t: number): void {
  const rot = -0.38;
  const rx = r * 1.78;
  const ry = r * 0.52;
  // back half of the ring
  ctx.save();
  ctx.strokeStyle = hexA('#fde68a', 0.4);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexA('#fde68a', 0.18);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.09, ry * 1.09, rot, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawSphere(ctx, x, y, r, color, lx, ly, 2, t);
  // front half of the ring
  ctx.save();
  ctx.strokeStyle = hexA('#fde68a', 0.75);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = hexA('#fde68a', 0.3);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 1.09, ry * 1.09, rot, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  // corona pulse
  const pulse = 1 + 0.07 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 5.3);
  const cg = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.05 * pulse);
  cg.addColorStop(0, 'rgba(253,224,71,0.32)');
  cg.addColorStop(0.55, 'rgba(245,158,11,0.14)');
  cg.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.05 * pulse, 0, Math.PI * 2);
  ctx.fill();
  drawSphere(ctx, x, y, r, '#f59e0b', -0.3, -0.4, 0, t);
  // boiling surface arcs
  ctx.save();
  ctx.strokeStyle = 'rgba(255,244,200,0.35)';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 3; i++) {
    const a0 = t * (0.35 + i * 0.12) + i * 2.1;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.55 + i * 0.15), a0, a0 + 2.1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  const p = 0.5 + 0.5 * Math.sin(t * 2.4);
  ctx.save();
  // outer rotating dashed ring
  ctx.setLineDash([14, 10]);
  ctx.lineDashOffset = -t * 26;
  ctx.strokeStyle = `rgba(251,191,36,${0.5 + 0.3 * p})`;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // inner ring
  ctx.strokeStyle = 'rgba(251,191,36,0.22)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  // rotating compass ticks
  const ta = t * 0.6;
  ctx.strokeStyle = 'rgba(253,230,138,0.8)';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 4; i++) {
    const a = ta + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * (r - 9), y + Math.sin(a) * (r - 9));
    ctx.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9));
    ctx.stroke();
  }
  // core beacon
  ctx.shadowColor = 'rgba(251,191,36,0.9)';
  ctx.shadowBlur = 14 + 10 * p;
  ctx.fillStyle = `rgba(253,230,138,${0.75 + 0.25 * p})`;
  ctx.beginPath();
  ctx.arc(x, y, 6 + 2 * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPod(ctx: CanvasRenderingContext2D, x: number, y: number, i: number, t: number): void {
  const s = 10 * (1 + 0.16 * Math.sin(t * 3 + i * 1.7));
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(45,212,191,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(45,212,191,0.92)';
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 6 + t * 0.5;
    const px = Math.cos(a) * s;
    const py = Math.sin(a) * s;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(240,253,250,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ============================================================ main canvas sub-component */

function OrbitCanvas({ mission, label, onWin, onLose, onHud }: {
  mission: Mission;
  label: string;
  onWin: (pods: number, fuelLeft: number, time: number) => void;
  onLose: (reason: 'crash' | 'lost' | 'timeout') => void;
  onHud: (s: HudSnap) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(initSim(mission));
  const viewRef = useRef({ cssW: 900 });
  const cbRef = useRef({ onWin, onLose, onHud });
  const stars = useMemo(() => makeStars(MISSIONS.indexOf(mission) + 3), [mission]);

  useEffect(() => {
    cbRef.current = { onWin, onLose, onHud };
  }, [onWin, onLose, onHud]);

  /* keep the backing store sized (device-pixel sharp) */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const w = canvas.clientWidth || 900;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * 0.75 * dpr);
      viewRef.current.cssW = w;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  /* physics + render loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sun = mission.bodies.find((b) => b.kind === 'sun');

    const burst = (x: number, y: number, c: string, n: number, speed: number) => {
      const s = simRef.current;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.9);
        s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7 + Math.random() * 0.7, max: 1.4, c, r: 1.5 + Math.random() * 2.5 });
      }
    };

    const step = (dt: number) => {
      const s = simRef.current;
      if (s.phase !== 'flight') return;
      s.time += dt;
      s.thrustingNow = false;
      let tx = 0;
      let ty = 0;
      if (s.thrusting && s.fuel > 0) {
        const dx = s.aimX - s.x;
        const dy = s.aimY - s.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) {
          tx = (dx / d) * THRUST_ACCEL;
          ty = (dy / d) * THRUST_ACCEL;
          s.fuel = Math.max(0, s.fuel - FUEL_BURN * dt);
          s.thrustingNow = true;
        }
      }
      stepProbe(s, mission.bodies, dt, tx, ty);
      const speed = Math.hypot(s.vx, s.vy);
      if (speed > 1) s.heading = Math.atan2(s.vy, s.vx);
      s.trailTick = (s.trailTick + 1) % 2;
      if (s.trailTick === 0) {
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 120) s.trail.shift();
      }
      // science pods
      for (let i = 0; i < mission.pods.length; i++) {
        if (!s.pods[i] && Math.hypot(s.x - mission.pods[i].x, s.y - mission.pods[i].y) < POD_PICKUP) {
          s.pods[i] = true;
          burst(mission.pods[i].x, mission.pods[i].y, '#5eead4', 12, 60);
          sfx.coin();
        }
      }
      // win — capture radius
      if (Math.hypot(s.x - mission.target.x, s.y - mission.target.y) < mission.target.r) {
        s.phase = 'won';
        burst(s.x, s.y, '#fbbf24', 26, 90);
        sfx.win();
        cbRef.current.onWin(s.pods.filter(Boolean).length, s.fuel, s.time);
        return;
      }
      // crash into a surface
      if (hitsBody(s.x, s.y, mission.bodies)) {
        s.phase = 'crashed';
        s.shake = 1;
        burst(s.x, s.y, '#fb923c', 30, 120);
        sfx.bad();
        cbRef.current.onLose('crash');
        return;
      }
      // drifted out of bounds
      if (outOfBounds(s.x, s.y)) {
        s.phase = 'lost';
        sfx.lose();
        cbRef.current.onLose('lost');
        return;
      }
      // mission clock
      if (s.time >= TIME_LIMIT) {
        s.phase = 'timeout';
        sfx.lose();
        cbRef.current.onLose('timeout');
      }
    };

    const draw = (t: number) => {
      const s = simRef.current;
      const cssW = viewRef.current.cssW;
      const px = WORLD.w / cssW; // css px → world units
      const dpr = canvas.width / Math.max(1, cssW);
      const scale = dpr * (cssW / WORLD.w);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - 0.03);
        ctx.translate((Math.random() - 0.5) * s.shake * 14, (Math.random() - 0.5) * s.shake * 14);
      }
      // deep space
      ctx.fillStyle = '#04070d';
      ctx.fillRect(-40, -40, WORLD.w + 80, WORLD.h + 80);
      for (const n of NEBULAS) {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0, `rgba(${n.c},${n.a})`);
        g.addColorStop(1, `rgba(${n.c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      }
      // starfield (2 layers, twinkle)
      for (const st of stars) {
        ctx.globalAlpha = st.base + 0.28 * Math.sin(t * st.sp + st.ph);
        ctx.fillStyle = '#e7f6f3';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // board frame
      ctx.strokeStyle = 'rgba(94,234,212,0.14)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.strokeRect(2, 2, WORLD.w - 4, WORLD.h - 4);
      ctx.setLineDash([]);
      // target station
      drawTarget(ctx, mission.target.x, mission.target.y, mission.target.r, t);
      // pods
      for (let i = 0; i < mission.pods.length; i++) {
        if (!s.pods[i]) drawPod(ctx, mission.pods[i].x, mission.pods[i].y, i, t);
      }
      // bodies
      for (const b of mission.bodies) {
        if (b.kind === 'sun') {
          drawSun(ctx, b.x, b.y, b.r, t);
        } else if (b.ring) {
          if (sun) {
            const dx = sun.x - b.x;
            const dy = sun.y - b.y;
            const d = Math.hypot(dx, dy) || 1;
            drawRingedPlanet(ctx, b.x, b.y, b.r, b.color, dx / d, dy / d, t);
          } else drawRingedPlanet(ctx, b.x, b.y, b.r, b.color, -0.55, -0.6, t);
        } else {
          let lx = -0.55;
          let ly = -0.6;
          if (sun) {
            const dx = sun.x - b.x;
            const dy = sun.y - b.y;
            const d = Math.hypot(dx, dy) || 1;
            lx = dx / d; ly = dy / d;
          }
          drawSphere(ctx, b.x, b.y, b.r, b.color, lx, ly, b.kind === 'planet' ? 2 : 1, t);
        }
      }
      // prediction while aiming
      if (s.phase === 'aiming' && s.drag && s.prediction && s.prediction.pts.length > 2) {
        const pts = s.prediction.pts;
        const n = pts.length;
        ctx.save();
        ctx.lineWidth = 2.4;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          ctx.globalAlpha = (1 - f) * 0.85 + 0.08;
          if (s.prediction.status === 'crash' && i > n - 8) ctx.strokeStyle = '#fb7185';
          else if (s.prediction.status === 'capture' && i > n * 0.82) ctx.strokeStyle = '#fbbf24';
          else ctx.strokeStyle = '#5eead4';
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (s.prediction.status === 'crash') {
          const h = pts[n - 1];
          ctx.strokeStyle = '#fb7185';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(h.x - 7, h.y - 7); ctx.lineTo(h.x + 7, h.y + 7);
          ctx.moveTo(h.x + 7, h.y - 7); ctx.lineTo(h.x - 7, h.y + 7);
          ctx.stroke();
        }
        if (s.prediction.status === 'capture') {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pts[n - 1].x, pts[n - 1].y, 12 + 4 * Math.sin(t * 6), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      // trail (golden, fading)
      if (s.trail.length > 2) {
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < s.trail.length; i++) {
            const f = i / s.trail.length;
            ctx.strokeStyle = `rgba(251,191,36,${(pass === 0 ? 0.16 : 0.4) * f})`;
            ctx.lineWidth = pass === 0 ? 5 * f + 1 : 1.6 * f + 0.5;
            ctx.beginPath();
            ctx.moveTo(s.trail[i - 1].x, s.trail[i - 1].y);
            ctx.lineTo(s.trail[i].x, s.trail[i].y);
            ctx.stroke();
          }
        }
      }
      // probe
      const pr = 15;
      // selection pulse while aiming
      if (s.phase === 'aiming') {
        ctx.strokeStyle = `rgba(94,234,212,${0.5 + 0.3 * Math.sin(t * 2.6)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr + 7 + 2.5 * Math.sin(t * 2.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.heading);
      if (s.thrustingNow) {
        const fl = 15 + Math.random() * 9;
        const fg = ctx.createLinearGradient(-8, 0, -8 - fl, 0);
        fg.addColorStop(0, 'rgba(253,224,71,0.95)');
        fg.addColorStop(0.6, 'rgba(245,158,11,0.55)');
        fg.addColorStop(1, 'rgba(245,158,11,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-7, 4.5);
        ctx.lineTo(-8 - fl, 0);
        ctx.lineTo(-7, -4.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowColor = 'rgba(251,191,36,0.8)';
      ctx.shadowBlur = 10;
      const pg = ctx.createLinearGradient(-8, 0, 11, 0);
      pg.addColorStop(0, '#f59e0b');
      pg.addColorStop(1, '#fffbeb');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-8, 7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, -7);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
      // aim arrow + power gauge + Δv label
      if (s.phase === 'aiming' && s.drag && s.dv > 0.5) {
        const L = Math.min(Math.hypot(s.drag.cx - s.drag.sx, s.drag.cy - s.drag.sy), MAX_DRAG);
        const a = Math.atan2(s.drag.cy - s.drag.sy, s.drag.cx - s.drag.sx);
        const ex = s.x + Math.cos(a) * L;
        const ey = s.y + Math.sin(a) * L;
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 7]);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12);
        ctx.lineTo(ex + Math.cos(a + 2.5) * 10, ey + Math.sin(a + 2.5) * 10);
        ctx.lineTo(ex + Math.cos(a - 2.5) * 10, ey + Math.sin(a - 2.5) * 10);
        ctx.closePath();
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        // power gauge arc around probe
        const frac = Math.min(1, s.dv / (MAX_DRAG * LAUNCH_SCALE));
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr + 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = frac > 0.92 ? '#fb7185' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(s.x, s.y, pr + 13, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        // Δv label
        const { locale } = useApp.getState();
        const label = `Δv ${localizeDigits(Math.round(s.dv), locale)}`;
        ctx.font = `bold ${Math.max(13, 15 * px)}px ui-sans-serif, system-ui, sans-serif`;
        const wTxt = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(2,6,12,0.72)';
        ctx.beginPath();
        ctx.roundRect(ex + 12, ey - 12, wTxt, 24, 7);
        ctx.fill();
        ctx.fillStyle = '#fde68a';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, ex + 19, ey);
        ctx.restore();
      }
      // particles
      for (const p of s.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // off-screen probe indicator
      if (s.phase === 'flight' && (s.x < 0 || s.x > WORLD.w || s.y < 0 || s.y > WORLD.h)) {
        const cx = Math.max(26, Math.min(WORLD.w - 26, s.x));
        const cy = Math.max(46, Math.min(WORLD.h - 60, s.y));
        const a = Math.atan2(s.y - cy, s.x - cx);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillStyle = `rgba(251,191,36,${0.65 + 0.3 * Math.sin(t * 5)})`;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, 8);
        ctx.lineTo(-8, -8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        const { locale } = useApp.getState();
        const dist = localizeDigits(Math.round(Math.hypot(s.x - cx, s.y - cy)), locale);
        ctx.font = `bold ${Math.max(12, 13 * px)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(253,230,138,0.9)';
        ctx.textBaseline = 'middle';
        ctx.fillText(dist, cx + 18, cy + 1);
      }
      // low-fuel edge pulse
      if (s.phase === 'flight' && s.fuel > 0 && s.fuel < mission.startFuel * 0.2) {
        ctx.strokeStyle = `rgba(244,63,94,${0.25 + 0.2 * Math.sin(t * 6)})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, WORLD.w - 6, WORLD.h - 6);
      }
      // vignette
      const vg = ctx.createRadialGradient(WORLD.w / 2, WORLD.h / 2, WORLD.h * 0.42, WORLD.w / 2, WORLD.h / 2, WORLD.h * 0.86);
      vg.addColorStop(0, 'rgba(2,6,12,0)');
      vg.addColorStop(1, 'rgba(2,6,12,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAt = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dtReal = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dtReal;
      while (acc >= DT) {
        step(DT);
        acc -= DT;
      }
      const s = simRef.current;
      if (s.phase === 'aiming' && s.drag) {
        const d = aimDelta(s);
        s.dv = d.dv;
        s.prediction = d.dv > 0.5 ? predictPath(s.x, s.y, d.vx, d.vy, mission.bodies, mission.target, PREDICT_STEPS) : null;
      } else if (s.phase === 'aiming') {
        s.dv = 0;
        s.prediction = null;
      }
      // particles advance on wall-clock (also animate after phase end)
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.life -= dtReal;
        p.x += p.vx * dtReal;
        p.y += p.vy * dtReal;
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (p.life <= 0) s.particles.splice(i, 1);
      }
      draw(now / 1000);
      if (now - hudAt > 150) {
        hudAt = now;
        cbRef.current.onHud({
          phase: s.phase,
          fuel: s.fuel,
          fuelMax: mission.startFuel,
          pods: s.pods.filter(Boolean).length,
          podsTotal: mission.pods.length,
          timeLeft: Math.max(0, TIME_LIMIT - s.time),
          dv: s.dv,
          aiming: s.phase === 'aiming',
          thrusting: s.thrustingNow,
          coasting: s.phase === 'flight' && s.fuel <= 0,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mission, stars]);

  /* pointer input — aiming (drag anywhere) & mid-flight burns */
  const getWorld = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WORLD.w, y: ((e.clientY - rect.top) / rect.height) * WORLD.h };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current;
    const p = getWorld(e);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (s.phase === 'aiming') {
      s.drag = { sx: p.x, sy: p.y, cx: p.x, cy: p.y };
    } else if (s.phase === 'flight') {
      s.thrusting = true;
      s.aimX = p.x;
      s.aimY = p.y;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current;
    if (!s.drag && !s.thrusting) return;
    const p = getWorld(e);
    if (s.drag) {
      s.drag.cx = p.x;
      s.drag.cy = p.y;
    } else if (s.thrusting && s.phase === 'flight') {
      s.aimX = p.x;
      s.aimY = p.y;
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current;
    if (s.phase === 'aiming' && s.drag) {
      const d = aimDelta(s);
      if (d.dv < 1.2) { // tiny drag = cancel, no fuel spent
        s.drag = null;
        s.dv = 0;
        s.prediction = null;
        return;
      }
      s.vx = d.vx;
      s.vy = d.vy;
      s.fuel = Math.max(0, s.fuel - d.dv * LAUNCH_FUEL_PER_DV);
      s.heading = Math.atan2(d.vy, d.vx);
      s.drag = null;
      s.phase = 'flight';
      sfx.drop();
    } else if (s.thrusting) {
      s.thrusting = false;
      s.thrustingNow = false;
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <canvas
      ref={canvasRef}
      className="block aspect-[4/3] w-full touch-none select-none"
      dir="ltr"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
    />
  );
}

/* ============================================================ main game component */

interface RunResult {
  win: boolean;
  reason?: 'crash' | 'lost' | 'timeout';
  pods?: number;
  fuelLeft?: number;
  time?: number;
  score?: number;
  prevBest?: number;
}

const emptyHud: HudSnap = {
  phase: 'aiming', fuel: 100, fuelMax: 100, pods: 0, podsTotal: 0,
  timeLeft: TIME_LIMIT, dv: 0, aiming: true, thrusting: false, coasting: false,
};

/* progress: 'doi_orbit_mission' = highest unlocked index; 'doi_orbit_best' = per-mission bests.
   Lazy-loaded (client-only mount — the game opens after a user click, never SSR'd). */
function loadUnlocked(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const u = Number(window.localStorage.getItem('doi_orbit_mission') ?? '0');
    if (Number.isFinite(u)) return Math.min(Math.max(0, Math.floor(u)), MISSIONS.length - 1);
  } catch { /* noop */ }
  return 0;
}

function loadBests(): number[] {
  const empty = MISSIONS.map(() => 0);
  if (typeof window === 'undefined') return empty;
  try {
    const b = JSON.parse(window.localStorage.getItem('doi_orbit_best') ?? '[]');
    if (Array.isArray(b)) return MISSIONS.map((_, i) => (typeof b[i] === 'number' && b[i] > 0 ? b[i] : 0));
  } catch { /* noop */ }
  return empty;
}

export function OrbitGame({ onExit }: { onExit: () => void }) {
  const { t, locale } = useApp();
  const { finish, rewards } = useArcadeFinish('orbit');
  const isRtl = locale === 'fa' || locale === 'ar';
  const [screen, setScreen] = useState<'select' | 'briefing' | 'play'>('select');
  const [missionIdx, setMissionIdx] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [unlocked, setUnlocked] = useState<number>(loadUnlocked);
  const [bests, setBests] = useState<number[]>(loadBests);
  const [codexOpen, setCodexOpen] = useState(false);
  const [hud, setHud] = useState<HudSnap>(emptyHud);
  const [result, setResult] = useState<RunResult | null>(null);
  const [dlgOpen, setDlgOpen] = useState(true);

  const mission = MISSIONS[missionIdx];
  const completedCount = useMemo(() => bests.filter((b) => b > 0).length, [bests]);
  const campaignDone = bests[MISSIONS.length - 1] > 0;

  const handleHud = useCallback((s: HudSnap) => setHud(s), []);

  const handleWin = useCallback((pods: number, fuelLeft: number, time: number) => {
    const idx = missionIdx;
    const score = 100 + Math.round(fuelLeft * 2) + pods * 100;
    const prevBest = bests[idx] ?? 0;
    setResult({ win: true, pods, fuelLeft, time, score, prevBest });
    setDlgOpen(true);
    const nu = Math.max(unlocked, Math.min(idx + 1, MISSIONS.length - 1));
    if (nu !== unlocked) setUnlocked(nu);
    const nb = [...bests];
    if (score > prevBest) nb[idx] = score;
    setBests(nb);
    try {
      window.localStorage.setItem('doi_orbit_mission', String(nu));
      window.localStorage.setItem('doi_orbit_best', JSON.stringify(nb));
    } catch { /* noop */ }
    void finish(score, { mission: idx + 1, pods, fuelLeft: Math.round(fuelLeft), outcome: 'win' });
  }, [missionIdx, bests, unlocked, finish]);

  const handleLose = useCallback((reason: 'crash' | 'lost' | 'timeout') => {
    setResult({ win: false, reason });
    setDlgOpen(true);
  }, []);

  const startMission = (i: number) => {
    setMissionIdx(i);
    setScreen('briefing');
    setResult(null);
    setDlgOpen(true);
    setHud({ ...emptyHud, fuel: MISSIONS[i].startFuel, fuelMax: MISSIONS[i].startFuel, podsTotal: MISSIONS[i].pods.length });
  };

  const restart = () => {
    sfx.click();
    setAttempt((a) => a + 1);
    setResult(null);
    setDlgOpen(true);
    setHud({ ...emptyHud, fuel: mission.startFuel, fuelMax: mission.startFuel, podsTotal: mission.pods.length });
  };

  const nextMission = () => {
    sfx.click();
    if (missionIdx < MISSIONS.length - 1) startMission(missionIdx + 1);
    else { setScreen('select'); setResult(null); }
  };

  const goPark = () => { sfx.click(); onExit(); };

  const openSelect = () => { sfx.click(); setScreen('select'); setResult(null); };

  const hudPct = Math.max(0, Math.min(100, (hud.fuel / Math.max(1, hud.fuelMax)) * 100));
  const fuelLow = hudPct < 20;
  const mm = Math.floor(hud.timeLeft / 60);
  const ss = Math.floor(hud.timeLeft % 60);
  const timeStr = `${mm}:${ss < 10 ? '0' : ''}${ss}`;

  /* ---------------------------------------------------------- campaign map */
  if (screen === 'select') {
    return (
      <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto w-full max-w-5xl px-3 py-5 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={goPark} aria-label={t('back_park')}>
            <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-xl font-black gold-text sm:text-2xl">
              <span className="text-2xl">🛰️</span> {t('game_orbit')}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{t('game_orbit_tag')}</p>
          </div>
          <Badge className="border-0 bg-amber-500/15 text-amber-300">📖 {t('campaign')}</Badge>
          <Button variant="outline" className="h-11 gap-1.5" onClick={() => { sfx.click(); setCodexOpen(true); }}>
            <BookOpen className="h-4 w-4" /> {t('codex')}
          </Button>
        </div>

        {campaignDone && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <Trophy className="h-6 w-6 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-black text-amber-300">🏆 {t('orbit_win')}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{pick(FINALE, locale)}</p>
            </div>
          </motion.div>
        )}

        <p className="mb-4 text-xs text-muted-foreground">
          {t('missions')}: <b className="text-amber-300">{localizeDigits(completedCount, locale)}</b> / {localizeDigits(MISSIONS.length, locale)}
        </p>

        {([1, 2, 3] as const).map((act) => (
          <motion.section
            key={act}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: act * 0.07 }}
            className="mb-6"
            aria-label={pick(ACTS[act].name, locale)}
          >
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-black text-amber-300">{pick(ACTS[act].name, locale)}</h3>
              <span className="text-[11px] text-muted-foreground">— {pick(ACTS[act].sub, locale)}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MISSIONS.map((m, i) => {
                const lo = [0, 4, 9][act - 1];
                const hi = [3, 8, 11][act - 1];
                if (i < lo || i > hi) return null;
                const locked = i > unlocked;
                const done = bests[i] > 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={locked}
                    onClick={() => { if (locked) { sfx.bad(); toast.info(t('mission_locked')); } else { sfx.click(); startMission(i); } }}
                    className={`royal-card group relative rounded-2xl border p-4 text-start transition-transform ${locked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:-translate-y-0.5 hover:border-amber-500/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-sm font-black text-amber-300">
                        {localizeDigits(i + 1, locale)}
                      </span>
                      {locked ? <Lock className="h-4 w-4 text-muted-foreground" />
                        : done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        : <span className="text-[10px] font-bold text-muted-foreground">🪐 {localizeDigits(m.bodies.length, locale)} · 🔬 {localizeDigits(m.pods.length, locale)}</span>}
                    </div>
                    <h4 className="mt-2 text-sm font-black">{pick(m.name, locale)}</h4>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {locked ? t('mission_locked') : done ? `🏆 ${t('best_score')}: ${localizeDigits(bests[i], locale)}` : pick(ACTS[m.act].name, locale)}
                    </p>
                  </button>
                );
              })}
            </div>
          </motion.section>
        ))}

        <CodexDialog open={codexOpen} onOpenChange={setCodexOpen} locale={locale} codexTitle={t('codex')} />
      </div>
    );
  }

  /* ---------------------------------------------------------- briefing */
  if (screen === 'briefing') {
    return (
      <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto w-full max-w-2xl px-3 py-5 sm:py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="royal-card rounded-2xl border border-amber-500/20 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <Badge className="border-0 bg-amber-500/15 text-amber-300">
              {t('mission')} {localizeDigits(missionIdx + 1, locale)} · {pick(ACTS[mission.act].name, locale)}
            </Badge>
            {bests[missionIdx] > 0 && <span className="text-[11px] text-muted-foreground">🏆 {localizeDigits(bests[missionIdx], locale)}</span>}
          </div>
          <h2 className="mt-3 text-2xl font-black gold-text">🛰️ {pick(mission.name, locale)}</h2>
          <p className="mt-3 min-h-20 text-sm leading-7 text-muted-foreground">{pick(mission.briefing, locale)}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1.5"><Target className="h-3.5 w-3.5 text-amber-400" /> {t('orbit_target')}</span>
            <span className="flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/5 px-3 py-1.5"><FlaskConical className="h-3.5 w-3.5 text-teal-400" /> {t('orbit_pods')} × {localizeDigits(mission.pods.length, locale)}</span>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1.5"><Fuel className="h-3.5 w-3.5 text-amber-400" /> {t('arcade_fuel')} {localizeDigits(mission.startFuel, locale)}</span>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1.5"><Timer className="h-3.5 w-3.5 text-amber-400" /> {localizeDigits(TIME_LIMIT, locale)}s</span>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 text-xs leading-relaxed text-teal-200/90">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
            <span>{pick(mission.hint, locale)}</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="lg" className="glow-gold h-12 flex-1 text-base font-black" onClick={() => { sfx.click(); setScreen('play'); }}>
              🚀 {t('arcade_launch')}
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={openSelect}>{t('missions')}</Button>
            <Button size="lg" variant="ghost" className="h-12" onClick={() => { sfx.click(); setCodexOpen(true); }} aria-label={t('codex')}>
              <BookOpen className="h-5 w-5" />
            </Button>
          </div>
        </motion.div>
        <CodexDialog open={codexOpen} onOpenChange={setCodexOpen} locale={locale} codexTitle={t('codex')} />
      </div>
    );
  }

  /* ---------------------------------------------------------- play */
  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto w-full max-w-[900px] px-2 py-3 sm:px-3 sm:py-5">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-[#04070d] shadow-2xl shadow-black/40" dir="ltr">
        <OrbitCanvas key={`${mission.id}-${attempt}`} mission={mission} label={`${pick(mission.name, locale)} — orbital mechanics canvas`} onWin={handleWin} onLose={handleLose} onHud={handleHud} />

        {/* HUD — top */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-bold text-amber-200 backdrop-blur-sm">
            🛰️ {t('mission')} {localizeDigits(missionIdx + 1, locale)}
          </span>
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm ${fuelLow ? 'animate-pulse border-rose-400/50 text-rose-300' : 'border-white/10 text-amber-100'} bg-black/50`}>
            {t('arcade_fuel')}
            <Progress value={hudPct} className="h-2 w-16 sm:w-24 [&>div]:bg-gradient-to-r [&>div]:from-amber-300 [&>div]:to-amber-500" aria-label={t('arcade_fuel')} />
            {localizeDigits(Math.round(hud.fuel), locale)}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-bold text-teal-200 backdrop-blur-sm">
            🔬 {localizeDigits(hud.pods, locale)}/{localizeDigits(hud.podsTotal, locale)}
          </span>
          <span className={`flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm ${hud.timeLeft < 15 ? 'text-rose-300' : 'text-amber-100'}`}>
            ⏱ {localizeDigits(timeStr, locale)}
          </span>
          {hud.aiming && (
            <span className="rounded-full border border-teal-400/30 bg-black/50 px-3 py-1.5 text-[11px] text-teal-200 backdrop-blur-sm">
              ✥ {pick(DRAG_HINT, locale)}
            </span>
          )}
          {hud.thrusting && (
            <span className="rounded-full border border-amber-400/40 bg-black/50 px-3 py-1.5 text-[11px] text-amber-200 backdrop-blur-sm">
              🔥 {pick(BURN_HINT, locale)}
            </span>
          )}
          {hud.coasting && (
            <span className="rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-sm">
              💨 {pick(COAST_HINT, locale)}
            </span>
          )}
        </div>

        {/* HUD — bottom controls (≥44px targets) */}
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-11 w-11 border-white/15 bg-black/50 text-amber-200 backdrop-blur-sm hover:bg-black/70" onClick={restart} aria-label={t('arcade_again')}>
              <RotateCcw className="h-5 w-5" />
            </Button>
            <Button variant="outline" size="icon" className="h-11 w-11 border-white/15 bg-black/50 text-amber-200 backdrop-blur-sm hover:bg-black/70" onClick={() => { sfx.click(); setCodexOpen(true); }} aria-label={t('codex')}>
              <BookOpen className="h-5 w-5" />
            </Button>
          </div>
          <Button variant="outline" className="h-11 border-white/15 bg-black/50 px-4 text-amber-200 backdrop-blur-sm hover:bg-black/70" onClick={goPark}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('back_park')}
          </Button>
        </div>

        {/* floating CTA after the dialog was dismissed */}
        {result && !dlgOpen && (
          <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center">
            <Button className="glow-gold h-11 px-6 font-black" onClick={result.win ? nextMission : restart}>
              {result.win ? (missionIdx < MISSIONS.length - 1 ? `🛰️ ${t('orbit_next')}` : `📖 ${t('missions')}`) : `↺ ${t('arcade_again')}`}
            </Button>
          </div>
        )}

        {/* victory panel */}
        <Dialog open={!!result?.win && dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="royal-card sm:max-w-sm" dir={isRtl ? 'rtl' : 'ltr'} aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="text-center text-xl font-black gold-text">
                <span className="me-1 inline-block animate-pop">{missionIdx === MISSIONS.length - 1 ? '🏆' : '🛰️'}</span>{' '}
                {missionIdx === MISSIONS.length - 1 ? t('orbit_win') : t('orbit_mission_complete')}
              </DialogTitle>
            </DialogHeader>
            <p className="text-center text-sm font-bold text-amber-200">{pick(mission.name, locale)}</p>
            {result?.win && missionIdx === MISSIONS.length - 1 && (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-center text-xs leading-relaxed text-amber-100/90">{pick(FINALE, locale)}</p>
            )}
            {result?.win && (
              <>
                <div className="space-y-1.5 py-1 text-sm">
                  <Row label={`${t('score')}`} value={localizeDigits(100, locale)} delay={0} />
                  <Row label={`🔬 ${t('orbit_pods')} × ${localizeDigits(result.pods ?? 0, locale)}`} value={localizeDigits((result.pods ?? 0) * 100, locale)} delay={0.05} />
                  <Row label={`⛽ ${t('arcade_fuel')}`} value={localizeDigits(Math.round((result.fuelLeft ?? 0) * 2), locale)} delay={0.1} />
                  <div className="my-1 border-t border-amber-500/20" />
                  <div className="flex items-center justify-between">
                    <span className="font-black text-amber-200">{t('score')}</span>
                    <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.16, type: 'spring', stiffness: 260, damping: 16 }} className="text-2xl font-black gold-text">
                      {localizeDigits(result.score ?? 0, locale)}
                    </motion.span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                  {(result.score ?? 0) > (result.prevBest ?? 0) && (result.prevBest ?? 0) > 0 && (
                    <Badge className="border-0 bg-emerald-500/15 text-emerald-300">✨ {pick(NEW_BEST, locale)}</Badge>
                  )}
                  {rewards && (
                    <>
                      <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-bold text-amber-400">+{localizeDigits(rewards.coins, locale)} 🪙</span>
                      <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 font-bold text-emerald-400">+{localizeDigits(rewards.xp, locale)} ✦</span>
                    </>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  {missionIdx < MISSIONS.length - 1 ? (
                    <Button className="glow-gold flex-1" onClick={nextMission}>🛰️ {t('orbit_next')}</Button>
                  ) : (
                    <Button className="glow-gold flex-1" onClick={() => { sfx.click(); setScreen('select'); setResult(null); }}>📖 {t('missions')}</Button>
                  )}
                  <Button variant="outline" className="flex-1" onClick={restart}>{t('arcade_again')}</Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* defeat panel */}
        <Dialog open={!!result && !result.win && dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="royal-card sm:max-w-sm" dir={isRtl ? 'rtl' : 'ltr'} aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="text-center text-xl font-black text-rose-300">
                <span className="me-1 inline-block animate-pop">{result?.reason === 'crash' ? '💥' : '🌌'}</span>
                {result?.reason === 'crash' ? t('orbit_crash') : t('orbit_lost')}
              </DialogTitle>
            </DialogHeader>
            <p className="text-center text-xs text-muted-foreground">{pick(mission.name, locale)} · 🔬 {localizeDigits(hud.pods, locale)}/{localizeDigits(hud.podsTotal, locale)}</p>
            <div className="flex items-start gap-2 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3 text-xs leading-relaxed text-teal-200/90">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
              <span>{pick(mission.hint, locale)}</span>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">{pick(TRY_AGAIN_TIP, locale)}</p>
            <div className="flex gap-2">
              <Button className="glow-gold flex-1" onClick={restart}>↺ {t('arcade_again')}</Button>
              <Button variant="outline" className="flex-1" onClick={goPark}>{t('back_park')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <CodexDialog open={codexOpen} onOpenChange={setCodexOpen} locale={locale} codexTitle={t('codex')} />
    </div>
  );
}

/* ============================================================ small pieces */

function Row({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay }} className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold text-amber-100">{value}</span>
    </motion.div>
  );
}

function CodexDialog({ open, onOpenChange, locale, codexTitle }: { open: boolean; onOpenChange: (o: boolean) => void; locale: string; codexTitle: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="royal-card nice-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-black gold-text">📖 {codexTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
          {CODEX.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3"
            >
              <div className="flex items-center gap-2 text-sm font-black text-amber-300">
                <span className="text-base">{c.icon === 'ellipse' ? '🛰️' : c.icon}</span> {pick(c.title, locale)}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{pick(c.text, locale)}</p>
            </motion.div>
          ))}
          <p className="pt-1 text-center text-[10px] text-muted-foreground">Newton 1687 · Hohmann 1925 · Oberth 1929 · Voyager GRA 1979</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
