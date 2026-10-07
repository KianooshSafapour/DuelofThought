'use client';

/**
 * Procedural animated backgrounds (canvas, requestAnimationFrame).
 * Kinds: velvet (floating dust), stars (parallax starfield), city (pixel skyline
 * + neon rain), dunes (drifting sand particles). Deterministic-ish, cheap.
 *
 * Performance contract:
 *  - `perfMode` (user preference) → static gradient, zero RAF loop
 *  - `gameActive` (a game is running) → static gradient, zero RAF loop
 *  - hidden tab → loop paused; mobile screens get ~half the particle budget
 */
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/app';

export function BackgroundCanvas({ kind, colors, accent }: { kind: string; colors: string[]; accent: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const gameActive = useApp((s) => s.gameActive);
  const perfMode = useApp((s) => s.perfMode);
  const frozen = gameActive || perfMode;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let running = !frozen;

    const resize = () => {
      cv.width = Math.min(window.innerWidth, 1600);
      cv.height = Math.min(window.innerHeight, 900);
    };
    resize();
    window.addEventListener('resize', resize);

    const paintStatic = () => {
      const g = ctx.createLinearGradient(0, 0, 0, cv.height);
      g.addColorStop(0, colors[0] ?? '#0f0524');
      g.addColorStop(0.6, colors[1] ?? '#1e1145');
      g.addColorStop(1, colors[2] ?? '#2a1a5e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cv.width, cv.height);
    };
    paintStatic();

    const mobile = window.innerWidth < 640;
    const rnd = Math.random;
    interface P { x: number; y: number; v: number; s: number; o: number; tw?: number }
    const baseN = kind === 'stars' ? 140 : kind === 'velvet' ? 70 : 60;
    const N = mobile ? Math.round(baseN * 0.45) : baseN;
    const parts: P[] = Array.from({ length: N }, () => ({
      x: rnd() * cv.width, y: rnd() * cv.height,
      v: 0.15 + rnd() * 0.5, s: kind === 'stars' ? (rnd() < 0.85 ? 1 : 2) : 1 + rnd() * 2,
      o: 0.2 + rnd() * 0.7, tw: rnd() * Math.PI * 2,
    }));
    // city skyline (fixed buildings)
    const buildings: { x: number; w: number; h: number }[] = [];
    if (kind === 'city') {
      let x = 0;
      while (x < cv.width) {
        const w = 30 + rnd() * 60;
        buildings.push({ x, w, h: 60 + rnd() * 180 });
        x += w + 8;
      }
    }

    const draw = (t: number) => {
      if (!running) return;
      // gradient base
      const g = ctx.createLinearGradient(0, 0, 0, cv.height);
      g.addColorStop(0, colors[0] ?? '#0f0524');
      g.addColorStop(0.6, colors[1] ?? '#1e1145');
      g.addColorStop(1, colors[2] ?? '#2a1a5e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cv.width, cv.height);

      if (kind === 'city') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (const b of buildings) ctx.fillRect(b.x, cv.height - b.h, b.w, b.h);
        // windows
        ctx.fillStyle = accent;
        for (const b of buildings) {
          const cols = Math.floor(b.w / 14);
          const rows = Math.floor(b.h / 18);
          for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
              if (((i * 7 + j * 13 + b.x) | 0) % 5 === 0 && Math.sin(t / 900 + i + j) > -0.3) {
                ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t / 700 + i * j);
                ctx.fillRect(b.x + 4 + i * 14, cv.height - b.h + 6 + j * 18, 5, 7);
              }
            }
          }
        }
        ctx.globalAlpha = 1;
      }

      if (kind === 'dunes') {
        ctx.fillStyle = 'rgba(255, 205, 112, 0.08)';
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          const yBase = cv.height - 60 - k * 50;
          ctx.moveTo(0, yBase);
          for (let x = 0; x <= cv.width; x += 40) {
            ctx.lineTo(x, yBase + Math.sin(x / 180 + t / 2400 + k * 2) * 18);
          }
          ctx.lineTo(cv.width, cv.height); ctx.lineTo(0, cv.height);
          ctx.closePath(); ctx.fill();
        }
      }

      // particles
      for (const p of parts) {
        p.y -= p.v;
        if (p.y < -4) { p.y = cv.height + 4; p.x = rnd() * cv.width; }
        const tw = kind === 'stars' ? 0.5 + 0.5 * Math.sin((t / 500) + (p.tw ?? 0)) : 1;
        ctx.globalAlpha = p.o * tw;
        ctx.fillStyle = accent;
        if (kind === 'city') {
          ctx.fillRect(p.x, p.y, p.s, p.s * 3); // neon rain streaks
        } else if (kind === 'stars') {
          ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    if (running) raf = requestAnimationFrame(draw);

    /* auto-pause when the tab is hidden (battery + CPU) */
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!frozen) {
        running = true;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [kind, colors, accent, frozen]);

  return (
    <canvas
      ref={ref}
      className="fixed inset-0 -z-10 h-full w-full"
      style={{ width: '100vw', height: '100vh', opacity: 0.55 }}
      aria-hidden
    />
  );
}

export function equippedBackground(code: string) {
  // local import-free lookup to avoid circular deps
  const map: Record<string, { kind: string; colors: string[]; accent: string }> = {
    bg_royal_velvet: { kind: 'velvet', colors: ['#0f0524', '#1e1145', '#2a1a5e'], accent: '#d4af37' },
    bg_starfield: { kind: 'stars', colors: ['#020617', '#0f172a', '#1e293b'], accent: '#fbbf24' },
    bg_pixel_city: { kind: 'city', colors: ['#1a0b2e', '#2d1b4e', '#443266'], accent: '#f472b6' },
    bg_dunes: { kind: 'dunes', colors: ['#431407', '#7c2d12', '#b45309'], accent: '#fcd34d' },
    bg_emerald: { kind: 'stars', colors: ['#022c22', '#064e3b', '#065f46'], accent: '#34d399' },
  };
  return map[code] ?? map.bg_royal_velvet;
}
