'use client';

/**
 * WinFireworks — full-screen procedural celebration overlay.
 * Visuals driven by the equipped EFFECT skin (fx_confetti / fx_gold / fx_pixels / fx_phoenix):
 *  - confetti: fluttering paper rects in skin colors
 *  - coins:    bouncing gold coins with sparkle
 *  - pixels:   chunky pixel squares (8-bit vibe) with gravity
 *  - phoenix:  rising embers + flame trails from bottom corners
 */
import { useEffect, useRef } from 'react';

export function WinFireworks({ active, colors, shape }: { active: boolean; colors: string[]; shape: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const W = cv.width, H = cv.height;
    let raf = 0;
    let running = true;

    interface P {
      x: number; y: number; vx: number; vy: number;
      s: number; c: string; rot: number; vr: number; life: number; maxLife: number;
      kind: 'rect' | 'coin' | 'pixel' | 'ember' | 'spark' | 'petal';
    }
    const parts: P[] = [];
    const rnd = Math.random;
    const pick = () => colors[Math.floor(rnd() * colors.length)] ?? '#fbbf24';

    const burst = (cx: number, cy: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const ang = rnd() * Math.PI * 2;
        const sp = 2 + rnd() * 7;
        parts.push({
          x: cx, y: cy,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2,
          s: shape === 'pixels' ? 6 + rnd() * 8 : shape === 'coins' ? 5 + rnd() * 5 : 4 + rnd() * 6,
          c: pick(), rot: rnd() * Math.PI, vr: (rnd() - 0.5) * 0.3,
          life: 0, maxLife: 90 + rnd() * 70,
          kind: shape === 'coins' ? 'coin' : shape === 'pixels' ? 'pixel' : shape === 'petals' ? 'petal' : 'rect',
        });
      }
    };

    const embers = () => {
      for (let i = 0; i < 3; i++) {
        parts.push({
          x: rnd() < 0.5 ? 40 + rnd() * 120 : W - 40 - rnd() * 120,
          y: H + 10,
          vx: (rnd() - 0.5) * 1.6, vy: -(4 + rnd() * 5),
          s: 3 + rnd() * 6, c: pick(), rot: 0, vr: 0,
          life: 0, maxLife: 120 + rnd() * 60, kind: 'ember',
        });
      }
    };

    // initial salvo
    const salvo = [0, 260, 560, 900].map((d) => setTimeout(() => {
      if (running) burst(W * (0.25 + rnd() * 0.5), H * (0.22 + rnd() * 0.25), 60);
    }, d));
    const phoenixTimer = shape === 'phoenix' ? setInterval(() => { if (running) embers(); }, 120) : null;

    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        if (p.kind === 'ember') {
          p.vy *= 0.99;
          p.vx += (rnd() - 0.5) * 0.12;
        } else {
          p.vy += 0.16; // gravity
          p.vx *= 0.99;
          p.rot += p.vr;
        }
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (alpha <= 0 || p.y > H + 40) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.c;
        if (p.kind === 'coin') {
          const squish = Math.abs(Math.cos(p.life * 0.18));
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.s * squish, p.s, p.rot, 0, Math.PI * 2);
          ctx.fill();
          if (rnd() < 0.12) { ctx.fillStyle = '#fffbeb'; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); }
        } else if (p.kind === 'pixel') {
          ctx.fillRect(Math.round(p.x / 6) * 6, Math.round(p.y / 6) * 6, p.s, p.s);
        } else if (p.kind === 'petal') {
          // drifting flower petal: soft ellipse with gentle sway
          const sway = Math.sin(p.life * 0.09 + p.rot) * 0.6;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot + sway);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.s * 0.75, p.s * 0.38, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (p.kind === 'ember') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.s * (1 - p.life / p.maxLife / 2), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = alpha * 0.4;
          ctx.beginPath();
          ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.s * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      if (parts.length === 0 && Date.now() - t0 > 1200) { running = false; return; }
      raf = requestAnimationFrame(tick);
    };
    const t0 = Date.now();
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      salvo.forEach(clearTimeout);
      if (phoenixTimer) clearInterval(phoenixTimer);
    };
  }, [active, colors, shape]);

  if (!active) return null;
  return (
    <canvas
      ref={ref}
      className="win-fireworks pointer-events-none fixed inset-0 z-[90]"
      style={{ width: '100vw', height: '100vh' }}
      aria-hidden
    />
  );
}

/** Resolve equipped effect skin to colors+shape (client-safe, mirrors STORE_ITEMS data). */
export function effectSkinVisual(code: string): { colors: string[]; shape: string } {
  const map: Record<string, { colors: string[]; shape: string }> = {
    fx_confetti: { colors: ['#fbbf24', '#f472b6', '#34d399', '#c084fc'], shape: 'confetti' },
    fx_gold: { colors: ['#fcd34d', '#f59e0b', '#fffbeb'], shape: 'coins' },
    fx_pixels: { colors: ['#5eead4', '#e879f9', '#fde047'], shape: 'pixels' },
    fx_galaxy: { colors: ['#c084fc', '#5eead4', '#f0abfc', '#fde047'], shape: 'pixels' },
    fx_phoenix: { colors: ['#f97316', '#ef4444', '#fbbf24'], shape: 'phoenix' },
    fx_petals: { colors: ['#fda4af', '#f472b6', '#fecdd3', '#fbbf24'], shape: 'petals' },
  };
  return map[code] ?? map.fx_confetti;
}
