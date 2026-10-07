'use client';

/**
 * RetroBoot — the super-retro opening sequence shared by every game.
 *
 * Pixel-art CRT power-on → player inserts an old cartridge into a vintage
 * console → green boot text → FAHRENHEIT STUDIOS logo → THOUGHTKEEPERS OF
 * TOMORROW'S EAST (co-developer & publisher) → game title card → play.
 *
 * Fully skippable (tap / click / any key). Pure CSS art, zero images,
 * ~7s by default, ~0.2s when skipped. RTL-neutral (always ltr, centered).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { sfx } from '@/lib/sound';

export interface RetroBootProps {
  /** big pixel title, e.g. "TINKTANK" */
  title: string;
  /** small subtitle under the title, e.g. "MISSION CAMPAIGN · 40 LEVELS" */
  subtitle?: string;
  /** accent color for the title + cartridge label */
  accent?: string;
  /** optional emoji stamped on the cartridge label */
  cartridgeIcon?: string;
  onDone: () => void;
}

const FAHRENHEIT = 'FAHRENHEIT STUDIOS';
const EAST = 'THOUGHTKEEPERS OF TOMORROW’S EAST';

type Phase = 'crt' | 'insert' | 'boot' | 'studio' | 'publisher' | 'title';

const PHASE_MS: Record<Phase, number> = {
  crt: 650, insert: 1500, boot: 1100, studio: 1500, publisher: 1500, title: 1800,
};
const ORDER: Phase[] = ['crt', 'insert', 'boot', 'studio', 'publisher', 'title'];

export function RetroBoot({ title, subtitle, accent = '#fbbf24', cartridgeIcon = '🎮', onDone }: RetroBootProps) {
  const { t } = useApp();
  const [phase, setPhase] = useState<Phase>('crt');
  const [flash, setFlash] = useState(true);
  const doneRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    onDone();
  }, [onDone]);

  /* phase state machine */
  useEffect(() => {
    let i = ORDER.indexOf(phase);
    const advance = () => {
      i += 1;
      if (i >= ORDER.length) { finish(); return; }
      const next = ORDER[i];
      setPhase(next);
      if (next === 'insert') sfx.click();
      if (next === 'boot') sfx.click();
      if (next === 'studio') sfx.coin();
      if (next === 'publisher') sfx.click();
      if (next === 'title') sfx.achievement();
      timer.current = setTimeout(advance, PHASE_MS[next]);
    };
    timer.current = setTimeout(advance, PHASE_MS.crt);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* skip on any interaction */
  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    window.addEventListener('touchstart', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('touchstart', skip);
    };
  }, [finish]);

  useEffect(() => {
    const id = setTimeout(() => setFlash(false), 260);
    return () => clearTimeout(id);
  }, []);

  const show = (p: Phase) => (phase === p ? 'retro-in' : 'hidden');

  return (
    <div
      className="fixed inset-0 z-[90] grid select-none place-items-center overflow-hidden bg-black"
      dir="ltr" role="presentation" aria-label="retro boot sequence"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* CRT scanlines + vignette + flicker */}
      <div className="pointer-events-none absolute inset-0 z-40 retro-scanlines" />
      <div className="pointer-events-none absolute inset-0 z-40" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
      <div className="pointer-events-none absolute inset-0 z-40 animate-pulse bg-white/[0.015]" />

      {/* power-on flash */}
      {flash && <div className="pointer-events-none absolute inset-0 z-50 bg-white" style={{ animation: 'retro-flash 0.25s ease-out forwards' }} />}

      {/* skip hint */}
      <div className="absolute bottom-5 left-0 right-0 z-50 text-center">
        <span className="retro-text text-[10px] tracking-[0.35em] text-zinc-500">{t('retro_skip')}</span>
      </div>

      {/* stage */}
      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center">

        {/* 1+2 — console & cartridge */}
        <div className={`flex flex-col items-center transition-opacity duration-300 ${phase === 'crt' || phase === 'insert' ? 'opacity-100' : 'opacity-0'} ${phase === 'crt' ? 'h-24' : 'h-auto'}`}>
          {phase === 'insert' && (
            <>
              {/* cartridge sliding into slot */}
              <div className="retro-cartridge-drop relative z-0 mb-[-6px] flex h-20 w-32 flex-col items-center justify-center rounded-t-sm border-2 border-b-0 border-zinc-600 bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.4)]">
                <div className="flex h-10 w-24 flex-col items-center justify-center gap-0.5 border border-zinc-500 bg-zinc-200 p-1">
                  <span className="retro-text text-[7px] font-bold text-zinc-800">{title}</span>
                  <span className="text-sm leading-none">{cartridgeIcon}</span>
                </div>
                <div className="absolute -bottom-1 left-2 right-2 h-1.5 bg-zinc-900/60" />
              </div>
            </>
          )}
          {/* console */}
          <div className="relative flex w-56 flex-col items-center rounded-md border-2 border-zinc-600 bg-gradient-to-b from-zinc-300 to-zinc-400 p-3 shadow-2xl">
            <div className="mb-2 h-3.5 w-40 rounded-sm border border-zinc-500 bg-zinc-800 shadow-inner" /> {/* slot */}
            <div className="flex w-full items-center justify-between">
              <span className="retro-text text-[8px] font-bold tracking-widest text-zinc-600">DUEL-8</span>
              <span className={`h-2.5 w-2.5 rounded-full border border-zinc-500 transition-colors duration-300 ${phase === 'crt' ? 'bg-red-600' : 'bg-emerald-500'} ${phase !== 'crt' && phase !== 'insert' ? 'shadow-[0_0_8px_2px_rgba(16,185,129,0.7)]' : ''}`} />
            </div>
          </div>
        </div>

        {/* 3 — boot text */}
        {phase === 'boot' && (
          <div className={`retro-in text-start font-mono text-[11px] leading-5 text-emerald-400 sm:text-xs`} style={{ textShadow: '0 0 8px rgba(52,211,153,0.8)' }}>
            <p>DUEL-8 BIOS v2.4 — MEMORY OK</p>
            <p>CARTRIDGE: {title}.BIN <span className="animate-pulse">▮</span></p>
            <p className="opacity-70">{t('retro_boot')}</p>
          </div>
        )}

        {/* 4 — Farenheit Studios */}
        <div className={`${show('studio')} retro-in flex flex-col items-center gap-3`}>
          <div className="relative grid h-16 w-16 place-items-center">
            {/* pixel flame */}
            <div className="grid grid-cols-5 gap-[2px]">
              {['0,1,1,1,0', '0,1,2,1,0', '0,1,2,1,0', '0,0,1,0,0', '0,0,0,0,0'].map((row, ri) => (
                <div key={ri} className="flex gap-[2px]">
                  {row.split(',').map((c, ci) => (
                    <span key={ci} className="h-2.5 w-2.5" style={{ background: c === '0' ? 'transparent' : c === '1' ? '#f97316' : '#fbbf24' }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="absolute inset-0 -z-10 blur-xl" style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.5), transparent 70%)' }} />
          </div>
          <p className="retro-text text-sm font-black tracking-[0.3em] text-amber-400 sm:text-base" style={{ textShadow: '0 0 14px rgba(251,191,36,0.6)' }}>{FAHRENHEIT}</p>
          <p className="retro-text text-[9px] tracking-[0.4em] text-zinc-500">PRESENTS</p>
        </div>

        {/* 5 — Thoughtkeepers of Tomorrow's East */}
        <div className={`${show('publisher')} retro-in flex flex-col items-center gap-3`}>
          <div className="relative grid h-16 w-16 place-items-center">
            {/* pixel brain-lantern */}
            <div className="grid grid-cols-5 gap-[2px]">
              {['0,1,1,1,0', '1,2,1,2,1', '1,1,2,1,1', '0,1,1,1,0', '0,0,1,0,0'].map((row, ri) => (
                <div key={ri} className="flex gap-[2px]">
                  {row.split(',').map((c, ci) => (
                    <span key={ci} className="h-2.5 w-2.5" style={{ background: c === '0' ? 'transparent' : c === '1' ? '#38bdf8' : '#e0f2fe' }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="absolute inset-0 -z-10 blur-xl" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.5), transparent 70%)' }} />
          </div>
          <p className="retro-text max-w-md text-[11px] font-bold leading-relaxed tracking-[0.25em] text-sky-300 sm:text-sm" style={{ textShadow: '0 0 14px rgba(56,189,248,0.55)' }}>{EAST}</p>
          <p className="retro-text text-[9px] tracking-[0.4em] text-zinc-500">CO-DEVELOPER · PUBLISHER</p>
        </div>

        {/* 6 — game title */}
        <div className={`${show('title')} retro-in flex flex-col items-center gap-3`}>
          <h1
            className="retro-text text-3xl font-black tracking-[0.2em] sm:text-5xl"
            style={{ color: accent, textShadow: `0 0 18px ${accent}aa, 4px 4px 0 rgba(0,0,0,0.9)` }}
          >
            {title}
          </h1>
          {subtitle && <p className="retro-text text-[10px] tracking-[0.35em] text-zinc-400 sm:text-xs">{subtitle}</p>}
        </div>
      </div>

      <style jsx global>{`
        .retro-text { font-family: 'Courier New', ui-monospace, monospace; image-rendering: pixelated; letter-spacing: 0.2em; }
        .retro-scanlines {
          background: repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px);
        }
        .retro-in { animation: retro-pop 0.45s steps(4) both; }
        .retro-cartridge-drop { animation: retro-insert 1.1s cubic-bezier(0.65, 0, 0.35, 1) both; }
        @keyframes retro-pop { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: scale(1); } }
        @keyframes retro-insert { 0% { transform: translateY(-90px); } 55% { transform: translateY(0); } 75% { transform: translateY(-6px); } 100% { transform: translateY(0); } }
        @keyframes retro-flash { from { opacity: 1; } to { opacity: 0; } }
      `}</style>
    </div>
  );
}
