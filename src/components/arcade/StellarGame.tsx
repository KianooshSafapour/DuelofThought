'use client';

/**
 * StellarGame — "Stellar Forge" (کورهٔ ستارگان)
 *
 * A stellar-nucleosynthesis merge puzzle: pick a gravity direction, all tiles
 * slide (2048 rules), equal elements fuse up the REAL stellar chain
 * H → He → C → O → Ne → Si → Fe. Score = "mass forged" ((level)² × 2 per merge).
 * Forging iron detonates a SUPERNOVA: +250, screen flash/shockwave, the grid
 * clears and the next star accretes 3 H per move. Star epochs (protostar →
 * supergiant) rise with mass. Includes a science codex (Burbidge et al. 1957).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '@/store/app';
import { localizeDigits, type Locale } from '@/lib/i18n';
import { sfx } from '@/lib/sound';
import { useArcadeFinish, ArcadeResultModal } from '@/lib/arcade-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Flame, RotateCcw, Sparkles, Star, X, Zap,
} from 'lucide-react';
import {
  BASE_SPAWN, CELLS, COLS, CODEX_CREDIT, ELEMENTS, EPOCHS, MOVE_THROTTLE_MS, NOVA_SPAWN,
  SF_TEXT, STAGES, SUPERNOVA_BONUS, epochForScore, hasMoves, initialBoard, slide, spawnRandom,
  type Cell, type Dir, type EpochDef, type StellarTile,
} from '@/lib/game/stellar-data';

/* ------------------------------ styling ------------------------------- */

const SF_CSS = `
.sf-shell{background:
  radial-gradient(120% 90% at 50% 0%, rgba(249,115,22,.14), transparent 60%),
  radial-gradient(130% 120% at 50% 115%, rgba(127,29,29,.38), transparent 55%),
  linear-gradient(180deg,#180a04 0%,#0d0503 60%,#080302 100%);}
.sf-shimmer-a,.sf-shimmer-b{position:absolute;inset:-18%;pointer-events:none;}
.sf-shimmer-a{background:radial-gradient(46% 34% at 30% 28%,rgba(251,146,60,.16),transparent 70%);animation:sf-shimmer-a 7s ease-in-out infinite alternate;}
.sf-shimmer-b{background:radial-gradient(40% 30% at 72% 66%,rgba(248,113,113,.14),transparent 70%);animation:sf-shimmer-b 9.5s ease-in-out infinite alternate;}
@keyframes sf-shimmer-a{from{opacity:.35;transform:scale(1) translateY(0)}to{opacity:.95;transform:scale(1.09) translateY(2%)}}
@keyframes sf-shimmer-b{from{opacity:.95;transform:scale(1.06)}to{opacity:.3;transform:scale(1)}}
.sf-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(125% 105% at 50% 42%,transparent 52%,rgba(0,0,0,.58) 100%);}

.sf-grid{--sf-gap:6px;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(6,1fr);gap:var(--sf-gap);position:relative;}
.sf-cell{border-radius:12px;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px rgba(255,255,255,.03);}
.sf-tile{position:absolute;left:0;top:0;z-index:10;pointer-events:none;
  width:calc((100% - 4*var(--sf-gap))/5);height:calc((100% - 5*var(--sf-gap))/6);
  transform:translate(calc(var(--c)*(100% + var(--sf-gap))),calc(var(--r)*(100% + var(--sf-gap))));
  transition:transform 120ms ease;}
.sf-ghost{z-index:9;}
.sf-pop{position:absolute;inset:0;}
.sf-pop.sf-merged{animation:sf-pop 300ms cubic-bezier(.2,1.4,.4,1) both;}
.sf-pop.sf-spawned{animation:sf-spawn 320ms cubic-bezier(.2,1.3,.4,1) both;}
@keyframes sf-pop{0%{transform:scale(.55)}60%{transform:scale(1.14)}100%{transform:scale(1)}}
@keyframes sf-spawn{0%{transform:scale(.25);opacity:0}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
.sf-face{position:absolute;inset:0;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:900;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -8px 16px rgba(0,0,0,.18),0 4px 14px rgba(0,0,0,.45),0 0 14px var(--sf-glow,transparent);
  animation:sf-float var(--sf-fl-dur,3.4s) ease-in-out var(--sf-fl-del,0s) infinite;}
.sf-ghost .sf-face{animation:sf-ghostfade 150ms ease-out both;}
@keyframes sf-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes sf-ghostfade{from{opacity:.95}to{opacity:0;transform:scale(.7)}}
.sf-ring{position:absolute;inset:-2px;border-radius:16px;border:2px solid rgba(255,255,255,.9);animation:sf-ring 420ms ease-out both;}
@keyframes sf-ring{from{opacity:.9;transform:scale(.75)}to{opacity:0;transform:scale(1.55)}}
.sf-fe .sf-face{animation:sf-float var(--sf-fl-dur,3.4s) ease-in-out var(--sf-fl-del,0s) infinite,sf-fe-pulse 1.2s ease-in-out infinite;}
@keyframes sf-fe-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.28)}}

.sf-nova{position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden;}
.sf-nova-flash{position:absolute;inset:0;background:radial-gradient(60% 60% at 50% 50%,#fff7ed,#fed7aa 45%,transparent 75%);animation:sf-flash 850ms ease-out both;}
.sf-nova-ring{position:absolute;left:50%;top:50%;width:140px;height:140px;margin:-70px 0 0 -70px;border-radius:9999px;
  border:6px solid rgba(253,186,116,.9);box-shadow:0 0 60px 20px rgba(251,146,60,.65),inset 0 0 40px rgba(255,237,213,.8);
  animation:sf-shock 850ms cubic-bezier(.15,.6,.3,1) both;}
.sf-nova-ring2{border-width:3px;border-color:rgba(255,255,255,.85);animation-delay:90ms;}
@keyframes sf-flash{0%{opacity:0}18%{opacity:.95}100%{opacity:0}}
@keyframes sf-shock{0%{opacity:1;transform:scale(.15)}100%{opacity:0;transform:scale(3.2)}}
.sf-nova-text{position:absolute;left:0;right:0;top:38%;text-align:center;animation:sf-novatext 1100ms ease-out both;}
.sf-nova-text b{display:block;font-size:clamp(1.6rem,7vw,2.6rem);font-weight:900;color:#fdba74;text-shadow:0 0 24px rgba(251,146,60,.9),0 2px 6px rgba(0,0,0,.6);}
.sf-nova-text small{display:block;margin-top:.35rem;max-width:34ch;margin-inline:auto;font-size:.78rem;color:#fed7aa;text-shadow:0 1px 4px rgba(0,0,0,.7);}
@keyframes sf-novatext{0%{opacity:0;transform:scale(.6)}22%{opacity:1;transform:scale(1.12)}70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.04)}}

@media (prefers-reduced-motion:reduce){
  .sf-shimmer-a,.sf-shimmer-b,.sf-face,.sf-ghost .sf-face,.sf-pop.sf-merged,.sf-pop.sf-spawned,.sf-ring,.sf-fe .sf-face{animation:none !important;}
  .sf-tile{transition:none;}
}
`;

const DPAD_ICONS: Record<Dir, typeof ChevronUp> = {
  up: ChevronUp,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
};

/* --------------------------- tile face -------------------------------- */

function TileFace({ tile, locale }: { tile: StellarTile; locale: Locale }) {
  const el = ELEMENTS[tile.level - 1];
  return (
    <div
      className="sf-face"
      dir="ltr"
      style={{
        background: `radial-gradient(circle at 32% 26%, ${el.light} 0%, ${el.mid} 52%, ${el.deep} 100%)`,
        color: el.ink,
        '--sf-glow': el.glow,
        '--sf-fl-dur': `${3 + (tile.level % 4) * 0.35}s`,
        '--sf-fl-del': `${((tile.id % 7) * 0.4).toFixed(2)}s`,
      } as CSSProperties}
    >
      <span className="absolute start-1 top-0.5 text-[9px] font-bold opacity-80">{localizeDigits(tile.level, locale)}</span>
      <span className="select-none text-[clamp(1.05rem,4.6vw,1.7rem)] leading-none tracking-tight">{el.symbol}</span>
    </div>
  );
}

/* ------------------------------ component ----------------------------- */

export function StellarGame({ onExit }: { onExit: () => void }) {
  const { t, locale } = useApp();
  const lang: 'fa' | 'en' = locale === 'fa' ? 'fa' : 'en';
  const rtl = locale === 'fa' || locale === 'ar';

  const { finish, rewards, lastScore, open: resultOpen, close: closeResult } = useArcadeFinish('stellar');

  /* ---- game state (refs mirror state for stable timers/handlers) ---- */
  const [board, setBoard] = useState<Cell[]>(initialBoard);
  const [mergedFlags, setMergedFlags] = useState<boolean[]>(() => Array<boolean>(CELLS).fill(false));
  const [spawnedIds, setSpawnedIds] = useState<number[]>([1, 2]);
  const [ghosts, setGhosts] = useState<{ key: number; level: number; index: number }[]>([]);
  const [score, setScore] = useState(0);
  const [supernovas, setSupernovas] = useState(0);
  const [star, setStar] = useState(1);
  const [forged, setForged] = useState<number[]>(() => Array<number>(8).fill(0));
  const [spawnedH, setSpawnedH] = useState(2);
  const [maxForged, setMaxForged] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [nova, setNova] = useState(false);
  const [novaKey, setNovaKey] = useState(0);

  const boardRef = useRef<Cell[]>(initialBoard());
  const scoreRef = useRef(0);
  const novaCountRef = useRef(0);
  const starRef = useRef(1);
  const spawnedHRef = useRef(2);
  const forgedRef = useRef<number[]>(Array<number>(8).fill(0));
  const maxForgedRef = useRef(1);
  const gameOverRef = useRef(false);
  const submittedRef = useRef(false);
  const codexOpenRef = useRef(false);
  const busyRef = useRef(false);
  const lastMoveRef = useRef(0);
  const moveTickRef = useRef(0);
  const idRef = useRef(3);
  const epochRef = useRef<EpochDef['id']>(epochForScore(0).id);
  const timersRef = useRef<number[]>([]);
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const finishRef = useRef(finish);
  const closeResultRef = useRef(closeResult);
  useEffect(() => {
    finishRef.current = finish;
    closeResultRef.current = closeResult;
  });

  const nextId = () => idRef.current++;

  const addTimer = (id: number) => {
    timersRef.current.push(id);
  };

  /* ---- run end: submit to the shared arcade economy ---- */
  const endRun = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    gameOverRef.current = true;
    setGameOver(true);
    sfx.lose();
    const meta = {
      star: starRef.current,
      epoch: epochForScore(scoreRef.current).id,
      maxElement: ELEMENTS[maxForgedRef.current - 1].symbol,
      supernovas: novaCountRef.current,
    };
    const finalScore = scoreRef.current;
    addTimer(window.setTimeout(() => { void finishRef.current(finalScore, meta); }, 650));
  };

  /* ---- restart / first mount ---- */
  const reset = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    const sp = spawnRandom(Array<Cell>(CELLS).fill(null), BASE_SPAWN, nextId);
    boardRef.current = sp.board;
    scoreRef.current = 0;
    novaCountRef.current = 0;
    starRef.current = 1;
    spawnedHRef.current = sp.spawned.length;
    forgedRef.current = Array<number>(8).fill(0);
    maxForgedRef.current = 1;
    gameOverRef.current = false;
    submittedRef.current = false;
    busyRef.current = false;
    lastMoveRef.current = 0;
    moveTickRef.current = 0;
    epochRef.current = epochForScore(0).id;
    setBoard(sp.board);
    setMergedFlags(Array<boolean>(CELLS).fill(false));
    setSpawnedIds(sp.spawned.map((s) => s.id));
    setGhosts([]);
    setScore(0);
    setSupernovas(0);
    setStar(1);
    setForged(Array<number>(8).fill(0));
    setSpawnedH(sp.spawned.length);
    setMaxForged(1);
    setGameOver(false);
    setNova(false);
    closeResultRef.current();
  }, []);

  /* ---- core move (gravity slide → fuse → spawn) ---- */
  const doMove = (dir: Dir) => {
    if (gameOverRef.current || busyRef.current || codexOpenRef.current) return;
    const now = Date.now();
    if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;

    const res = slide(boardRef.current, dir);
    if (!res) return; // nothing would move — invalid move

    moveTickRef.current += 1;
    const ghostKeys = res.absorbed.map(() => nextId());
    const newGhosts = res.absorbed.map((a, i) => ({ key: ghostKeys[i], level: a.level, index: a.index }));

    // mass forged
    scoreRef.current += res.gained;
    setScore(scoreRef.current);
    if (res.absorbed.length > 0) sfx.capture();
    else sfx.drop();

    // forge counters
    if (res.maxMergedLevel > 0) {
      for (let lvl = 2; lvl <= 7; lvl++) forgedRef.current[lvl] += res.forged[lvl];
      if (res.maxMergedLevel > maxForgedRef.current) maxForgedRef.current = res.maxMergedLevel;
      setForged([...forgedRef.current]);
      setMaxForged(maxForgedRef.current);
    }

    if (res.feForged > 0) {
      /* -------- SUPERNOVA: iron forged → star dies, grid clears -------- */
      novaCountRef.current += res.feForged;
      starRef.current += res.feForged;
      scoreRef.current += SUPERNOVA_BONUS * res.feForged;
      setScore(scoreRef.current);
      setSupernovas(novaCountRef.current);
      setStar(starRef.current);
      setNovaKey((k) => k + 1);
      setNova(true);
      sfx.win();
      busyRef.current = true;
      boardRef.current = res.board;
      setBoard(res.board);
      setMergedFlags(res.merged);
      setGhosts(newGhosts);
      setSpawnedIds([]);
      addTimer(window.setTimeout(() => {
        const sp = spawnRandom(Array<Cell>(CELLS).fill(null), NOVA_SPAWN, nextId);
        spawnedHRef.current += sp.spawned.length;
        boardRef.current = sp.board;
        setBoard(sp.board);
        setMergedFlags(Array<boolean>(CELLS).fill(false));
        setSpawnedIds(sp.spawned.map((s) => s.id));
        setSpawnedH(spawnedHRef.current);
        setGhosts([]);
        setNova(false);
        busyRef.current = false;
        if (!hasMoves(sp.board)) endRun();
      }, 750));
    } else {
      /* -------- normal move: spawn H into random empty cells -------- */
      const rate = novaCountRef.current > 0 ? NOVA_SPAWN : BASE_SPAWN;
      const sp = spawnRandom(res.board, rate, nextId);
      spawnedHRef.current += sp.spawned.length;
      boardRef.current = sp.board;
      setBoard(sp.board);
      setMergedFlags(res.merged);
      setGhosts(newGhosts);
      setSpawnedIds(sp.spawned.map((s) => s.id));
      setSpawnedH(spawnedHRef.current);
      addTimer(window.setTimeout(() => {
        setGhosts((prev) => prev.filter((g) => !ghostKeys.includes(g.key)));
      }, 190));
      if (!hasMoves(sp.board)) endRun();
    }

    // epoch glow / fanfare
    const ep = epochForScore(scoreRef.current);
    if (ep.id !== epochRef.current) {
      epochRef.current = ep.id;
      sfx.levelup();
    }
  };

  /* ---- keyboard (arrow keys), swipe handled via pointer events ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (codexOpenRef.current || gameOverRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      doMove(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---- timer cleanup on unmount ---- */
  useEffect(() => () => {
    for (const id of timersRef.current) window.clearTimeout(id);
  }, []);

  /* ---- swipe on the grid (pointer events, 24px threshold) ---- */
  const onPointerDown = (e: ReactPointerEvent) => {
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const p = pointerRef.current;
    pointerRef.current = null;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  /* ---- derived ---- */
  const epoch = epochForScore(score);
  const spawnRate = supernovas > 0 ? NOVA_SPAWN : BASE_SPAWN;
  const chips = ELEMENTS.map((el) => ({ el, count: el.level === 1 ? spawnedH : forged[el.level] }));
  const ghostSet = new Set(ghosts.map((g) => g.key));

  const openCodex = () => {
    codexOpenRef.current = true;
    setCodexOpen(true);
    sfx.click();
  };

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="mx-auto w-full max-w-[520px] px-2 pb-6 pt-2">
      <style>{SF_CSS}</style>

      {/* ---------- forge chamber ---------- */}
      <div className="sf-shell relative overflow-hidden rounded-3xl border border-amber-500/25 shadow-2xl shadow-black/50">
        <div className="sf-shimmer-a" aria-hidden />
        <div className="sf-shimmer-b" aria-hidden />
        <div className="sf-vignette" aria-hidden />

        <div className="relative z-10 p-3 sm:p-4">
          {/* ---------- HUD ---------- */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-base font-black text-amber-100 sm:text-lg">
                <Star className="h-4 w-4 shrink-0 text-amber-400" fill="currentColor" />
                {t('game_stellar')}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  key={epoch.id}
                  className="animate-pop inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold"
                  style={{ color: epoch.color, borderColor: `${epoch.color}55`, background: `${epoch.color}14`, boxShadow: `0 0 12px ${epoch.color}44` }}
                >
                  <Sparkles className="h-3 w-3" />
                  {t('stellar_epoch')}: {epoch[lang]}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-200" title={t('stellar_star')}>
                  <Star className="h-3 w-3" fill="currentColor" />
                  {t('stellar_star')} {localizeDigits(star, locale)}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[11px] font-bold text-orange-300"
                  title={SF_TEXT.spawnRate[lang]}
                >
                  <Zap className="h-3 w-3" />
                  ×{localizeDigits(spawnRate, locale)}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-end">
              <div className="text-[10px] uppercase tracking-wide text-amber-200/60">{t('stellar_mass')}</div>
              <div className="gold-text text-2xl font-black leading-none sm:text-3xl">{localizeDigits(score, locale)}</div>
            </div>
          </div>

          {/* ---------- controls ---------- */}
          <div className="mt-2 flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-10 w-10 text-amber-200 hover:bg-white/10 hover:text-amber-100"
              aria-label={t('arcade_again')} title={t('arcade_again')}
              onClick={() => { sfx.click(); reset(); }}
            >
              <RotateCcw className="h-4.5 w-4.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-10 w-10 text-amber-200 hover:bg-white/10 hover:text-amber-100"
              aria-label={t('codex')} title={t('codex')}
              onClick={openCodex}
            >
              <BookOpen className="h-4.5 w-4.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-10 w-10 text-amber-200 hover:bg-white/10 hover:text-amber-100"
              aria-label={t('back_park')} title={t('back_park')}
              onClick={onExit}
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="ms-auto hidden text-[10px] text-muted-foreground sm:block" dir="ltr">← ↑ ↓ → / swipe</span>
          </div>

          {/* ---------- grid ---------- */}
          <div
            className="sf-grid relative mt-2 aspect-[5/6] w-full touch-none select-none rounded-2xl border border-white/10 bg-black/35 p-0"
            dir="ltr"
            role="application"
            aria-label={`${t('game_stellar')} — ${t('game_stellar_desc')}`}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { pointerRef.current = null; }}
          >
            {/* cell backdrops */}
            {Array.from({ length: CELLS }, (_, i) => (
              <div key={`c${i}`} className="sf-cell" aria-hidden />
            ))}

            {/* absorbed-tile ghosts (fade under the fresh merge) */}
            {ghosts.map((g) => (
              <div
                key={g.key}
                className="sf-tile sf-ghost"
                style={{ '--c': g.index % COLS, '--r': Math.floor(g.index / COLS) } as CSSProperties}
                aria-hidden
              >
                <div className="sf-pop">
                  <TileFace tile={{ id: g.key, level: g.level }} locale={locale} />
                </div>
              </div>
            ))}

            {/* living tiles */}
            {board.map((tile, i) => {
              if (!tile) return null;
              const isNew = spawnedIds.includes(tile.id);
              const isMerged = mergedFlags[i] && !isNew && !ghostSet.has(tile.id);
              return (
                <div
                  key={tile.id}
                  className={`sf-tile ${tile.level === 7 ? 'sf-fe' : ''}`}
                  style={{ '--c': i % COLS, '--r': Math.floor(i / COLS) } as CSSProperties}
                >
                  <div className={`sf-pop ${isMerged ? 'sf-merged' : ''} ${isNew ? 'sf-spawned' : ''}`}>
                    <TileFace tile={tile} locale={locale} />
                    {isMerged && <span className="sf-ring" aria-hidden />}
                  </div>
                </div>
              );
            })}

            {/* ---------- end-of-run summary (behind the rewards modal) ---------- */}
            {gameOver && (
              <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-black/80 p-3 backdrop-blur-sm">
                <div className="animate-pop w-full max-w-[300px] space-y-2.5 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-amber-200/60">{t('stellar_epoch')}</div>
                  <div className="text-2xl font-black" style={{ color: epoch.color, textShadow: `0 0 18px ${epoch.color}88` }}>
                    {epoch[lang]}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-amber-200/60">{t('stellar_mass')}</div>
                    <div className="gold-text text-3xl font-black leading-tight">{localizeDigits(score, locale)}</div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {chips.map(({ el, count }) => (
                      <span
                        key={el.symbol}
                        dir="ltr"
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${count > 0 ? '' : 'opacity-35'}`}
                        style={{ color: el.mid, borderColor: `${el.deep}66`, background: `${el.mid}12` }}
                      >
                        {el.symbol}×{localizeDigits(count, locale)}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                    <span>💥 ×{localizeDigits(supernovas, locale)}</span>
                    <span>⭐ {t('stellar_star')} {localizeDigits(star, locale)}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button className="glow-gold flex-1" onClick={() => { sfx.click(); reset(); }}>{t('arcade_again')}</Button>
                    <Button variant="outline" className="flex-1" onClick={() => { sfx.click(); onExit(); }}>{t('back_park')}</Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ---------- d-pad (plus shape, physical directions) ---------- */}
          <div className="mx-auto mt-3 grid w-fit grid-cols-3 gap-2" dir="ltr" role="group" aria-label={SF_TEXT.hint[lang]}>
            <div />
            <DPad dir="up" lang={lang} onPress={doMove} />
            <div />
            <DPad dir="left" lang={lang} onPress={doMove} />
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/5" aria-hidden>
              <Sparkles className="h-5 w-5 text-amber-400/70" />
            </div>
            <DPad dir="right" lang={lang} onPress={doMove} />
            <div />
            <DPad dir="down" lang={lang} onPress={doMove} />
            <div />
          </div>

          <p className="mt-2 text-center text-[10px] text-muted-foreground sm:hidden">{SF_TEXT.hint[lang]}</p>
        </div>
      </div>

      {/* ---------- supernova overlay ---------- */}
      {nova && (
        <div className="sf-nova" key={novaKey} aria-hidden>
          <div className="sf-nova-flash" />
          <div className="sf-nova-ring" />
          <div className="sf-nova-ring sf-nova-ring2" />
          <div className="sf-nova-text" dir={rtl ? 'rtl' : 'ltr'}>
            <b>💥 {t('stellar_supernova')}</b>
            <small>{t('stellar_supernova_desc')}</small>
          </div>
        </div>
      )}

      {/* ---------- science codex ---------- */}
      <Dialog
        open={codexOpen}
        onOpenChange={(o) => {
          codexOpenRef.current = o;
          setCodexOpen(o);
        }}
      >
        <DialogContent className="royal-card max-h-[85vh] overflow-hidden sm:max-w-md" aria-describedby={undefined} dir={rtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="gold-text flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-amber-400" />
              {t('codex')} · {t('game_stellar')}
            </DialogTitle>
          </DialogHeader>
          <div className="nice-scroll -mx-1 max-h-[62vh] space-y-3 overflow-y-auto px-1 pe-1">
            <p className="text-xs leading-relaxed text-muted-foreground">{SF_TEXT.intro[lang]}</p>

            <h4 className="flex items-center gap-1.5 pt-1 text-xs font-black text-amber-200">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              {SF_TEXT.elementsHdr[lang]}
            </h4>
            <div className="space-y-2">
              {ELEMENTS.map((el) => (
                <div key={el.symbol} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-sm font-black"
                    dir="ltr"
                    style={{
                      background: `radial-gradient(circle at 32% 26%, ${el.light} 0%, ${el.mid} 52%, ${el.deep} 100%)`,
                      color: el.ink,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,.5), 0 0 10px ${el.glow}`,
                    }}
                  >
                    {el.symbol}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <b className="text-sm" style={{ color: el.mid }}>{el[lang]}</b>
                      <span className="text-[10px] text-muted-foreground" dir="ltr">{localizeDigits(el.level, locale)} · {el.symbol}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{lang === 'fa' ? el.blurbFa : el.blurbEn}</p>
                  </div>
                </div>
              ))}
            </div>

            <h4 className="flex items-center gap-1.5 pt-1 text-xs font-black text-amber-200">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              {SF_TEXT.stagesHdr[lang]}
            </h4>
            <div className="space-y-2">
              {STAGES.map((st, i) => {
                const ep = EPOCHS.find((e) => e.id === st.epoch)!;
                return (
                  <div key={st.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-amber-500/15 text-[10px] font-black text-amber-300">
                        {localizeDigits(i + 1, locale)}
                      </span>
                      <b className="text-sm" style={{ color: ep.color }}>{lang === 'fa' ? st.fa : st.en}</b>
                      <span
                        className="ms-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold"
                        style={{ color: ep.color, borderColor: `${ep.color}44`, background: `${ep.color}10` }}
                      >
                        {ep[lang]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{lang === 'fa' ? st.blurbFa : st.blurbEn}</p>
                  </div>
                );
              })}
            </div>

            <div dir="ltr" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 text-center text-[10px] italic text-muted-foreground">
              {CODEX_CREDIT}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- shared rewards modal ---------- */}
      <ArcadeResultModal
        open={resultOpen}
        title={t('arcade_done')}
        subtitle={`${epoch[lang]} · 💥 ×${localizeDigits(supernovas, locale)}`}
        score={lastScore}
        rewards={rewards}
        emoji="🌟"
        onAgain={() => { reset(); }}
        onExit={onExit}
      />
    </div>
  );
}

/* ------------------------------ d-pad btn ----------------------------- */

function DPad({ dir, lang, onPress }: { dir: Dir; lang: 'fa' | 'en'; onPress: (d: Dir) => void }) {
  const Icon = DPAD_ICONS[dir];
  return (
    <button
      type="button"
      aria-label={SF_TEXT.dirLabels[dir][lang]}
      onClick={() => onPress(dir)}
      className="pressable grid h-14 w-14 place-items-center rounded-2xl border border-amber-500/25 bg-white/5 text-amber-200 shadow-lg shadow-black/40 transition-colors hover:bg-white/10 hover:text-amber-100 active:bg-amber-500/20"
    >
      <Icon className="h-7 w-7" />
    </button>
  );
}
