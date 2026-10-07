'use client';

/**
 * SynapseGame — سیناپس: dual n-back working-memory trainer with the
 * 20-day "Mind Clinic" (کلینیک ذهن) story campaign.
 *
 * Science (stated honestly in the intro): dual n-back (Jaeggi et al., PNAS 2008)
 * trains working memory; the adaptive rule keeps the player at their edge.
 *
 * Engine: a setTimeout trial chain lives in refs (no per-tick React state);
 * HUD state updates once per trial (2.6 s cadence). Audio is a tiny local
 * WebAudio graph (sine + soft octave harmonic, gain ≤ 0.14), unlocked lazily
 * on the first user gesture. Economy contract: useArcadeFinish('synapse').
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown, ArrowUp, BookOpen, BrainCircuit, Check, Dumbbell, Eye, EyeOff, FlaskConical,
  Grid3x3, Lock, Minus, Play, RotateCcw, Volume2, X,
} from 'lucide-react';
import { useApp } from '@/store/app';
import { localizeDigits } from '@/lib/i18n';
import { useArcadeFinish, ArcadeResultModal } from '@/lib/arcade-client';
import { sfx } from '@/lib/sound';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  BASE_TRIALS, CHANNEL_POS, CHANNEL_SND, CONTINUE_BTN, CONTINUE_NOTE, FA_POINTS, GLYPH_TOGGLE,
  HIT_POINTS, HOWTO_POS, HOWTO_SND, INTERLUDE_TITLE, LOCAL_SAVE_NOTE, MENU_BTN, POS_NAMES,
  PRACTICE_BLURB, PRACTICE_TITLE, SCIENCE_NOTE, SESSION_BLOCKS, STAT_WORDS, STIM_MS,
  SYNAPSE_ACTS, SYNAPSE_DAYS, SYNAPSE_LETTERS, SYNAPSE_TONES, TRIAL_MS, effectiveAcc, genBlock,
  loadLastN, loadMaxDay, nextN, pick, saveLastN, saveMaxDay,
  type SynapseDay,
} from '@/lib/game/synapse-data';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Phase = 'home' | 'countdown' | 'playing' | 'interlude' | 'results';
type Channel = 'pos' | 'snd';
type Fx = 'hit' | 'fa' | null;

interface ChannelStats { hits: number; misses: number; fa: number; opps: number }
interface BlockSummary { n: number; pos: ChannelStats; snd: ChannelStats; acc: number }
interface Summary {
  title: string;
  blocks: BlockSummary[];
  pos: ChannelStats;
  snd: ChannelStats;
  score: number;
  accPct: number;
}
interface BriefItem {
  mode: 'campaign' | 'practice';
  day: number;
  startN: number;
  title: string;
  note: string;
  actTitle: string;
}

function emptyStats(): ChannelStats {
  return { hits: 0, misses: 0, fa: 0, opps: 0 };
}

function sumStats(list: ChannelStats[]): ChannelStats {
  return list.reduce(
    (a, c) => ({ hits: a.hits + c.hits, misses: a.misses + c.misses, fa: a.fa + c.fa, opps: a.opps + c.opps }),
    emptyStats(),
  );
}

/* ------------------------------------------------------------------ */
/* Local WebAudio graph (letter tones + feedback blips)                */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function releaseAudio() {
  if (audioCtx) {
    const c = audioCtx;
    audioCtx = null;
    void c.close().catch(() => undefined);
  }
}

/** Letter tone: sine fundamental + soft octave harmonic, 350 ms gentle envelope, master gain 0.14. */
function playLetter(idx: number, on: boolean) {
  if (!on) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const f = SYNAPSE_TONES[idx];
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.14;
  master.connect(ctx.destination);
  const voice = (freq: number, vol: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  };
  voice(f, 1);
  voice(f * 2, 0.25);
}

/** Tiny press-feedback blips (correct = bright tick, false alarm = low thud). */
function playBlip(kind: 'good' | 'bad', on: boolean) {
  if (!on) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = kind === 'good' ? 880 : 185;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(kind === 'good' ? 0.07 : 0.06, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'good' ? 0.09 : 0.16));
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

/* ------------------------------------------------------------------ */
/* Scoped styles (clinical violet/teal, breathing grid, trial ring)    */
/* ------------------------------------------------------------------ */

const SYN_CSS = `
.syn-glass { background: linear-gradient(165deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 60%, rgba(0,0,0,0.12)); border: 1px solid rgba(255,255,255,0.10); box-shadow: 0 12px 44px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06); backdrop-filter: blur(10px); }
.syn-glow-soft { box-shadow: 0 0 16px rgba(192,132,252,0.35); }
.syn-breathe { animation: synBreathe 5.6s ease-in-out infinite; }
@keyframes synBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.014); } }
.syn-tile { position: relative; border-radius: 1rem; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.09); box-shadow: inset 0 2px 10px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.04); transition: background 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease; }
.syn-tile-on { background: radial-gradient(circle at 50% 45%, rgba(216,180,254,0.95) 0%, rgba(147,51,234,0.5) 42%, rgba(147,51,234,0.08) 75%); border-color: rgba(192,132,252,0.9); box-shadow: 0 0 26px rgba(192,132,252,0.55), 0 0 64px rgba(147,51,234,0.28), inset 0 0 18px rgba(192,132,252,0.4); }
.syn-pulse { position: absolute; inset: -3px; border-radius: 1.15rem; border: 2px solid rgba(216,180,254,0.9); animation: synPulse 0.6s ease-out both; pointer-events: none; }
@keyframes synPulse { 0% { transform: scale(0.92); opacity: 0.85; } 100% { transform: scale(1.22); opacity: 0; } }
.syn-drain { animation-name: synDrain; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes synDrain { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 75.4; } }
.syn-count { animation: synCount 0.6s ease-out both; }
@keyframes synCount { 0% { transform: scale(1.7); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1); opacity: 0.95; } }
@media (prefers-reduced-motion: reduce) { .syn-breathe, .syn-pulse, .syn-drain, .syn-count { animation: none !important; } }
`;

/* ------------------------------------------------------------------ */
/* Presentational helper: per-channel results card                     */
/* ------------------------------------------------------------------ */

function ChannelCard({ title, icon, tone, stats, labels }: {
  title: string;
  icon: React.ReactNode;
  tone: 'teal' | 'violet';
  stats: ChannelStats;
  labels: { hits: string; misses: string; falseAlarms: string };
}) {
  const ring = tone === 'teal' ? 'border-teal-400/25' : 'border-violet-400/25';
  const text = tone === 'teal' ? 'text-teal-200' : 'text-violet-200';
  const row = (label: string, value: number, iconEl: React.ReactNode, cls: string) => (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        {iconEl}
        {label}
      </span>
      <b className={cls}>{value}</b>
    </li>
  );
  return (
    <div className={`rounded-2xl border ${ring} bg-white/[0.03] p-3`}>
      <p className={`flex items-center gap-1.5 text-[11px] font-black ${text}`}>{icon}{title}</p>
      <ul className="mt-2 space-y-1.5 text-[11px] text-white/70">
        {row(labels.hits, stats.hits, <Check className="h-3 w-3 text-teal-300" />, 'text-teal-200')}
        {row(labels.misses, stats.misses, <Minus className="h-3 w-3 text-amber-300" />, 'text-amber-200')}
        {row(labels.falseAlarms, stats.fa, <X className="h-3 w-3 text-rose-300" />, 'text-rose-200')}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function SynapseGame({ onExit }: { onExit: () => void }) {
  const { t, locale, user } = useApp();
  const { finish, rewards, open, close } = useArcadeFinish('synapse');
  const isRtl = locale === 'fa' || locale === 'ar';
  const loc = useCallback((v: string | number) => localizeDigits(v, locale), [locale]);
  const pctSign = locale === 'fa' ? '٪' : '%';

  /* ---------- persistent/local UI state ---------- */
  const [maxDay, setMaxDay] = useState(0);
  const [phase, setPhase] = useState<Phase>('home');
  const [brief, setBrief] = useState<BriefItem | null>(null);
  const [showGlyph, setShowGlyph] = useState(true);
  const [count, setCount] = useState(3);
  const [session, setSession] = useState<{ mode: 'campaign' | 'practice'; day: number; title: string } | null>(null);

  /* ---------- live HUD state (updated once per trial, never per tick) ---------- */
  const [activeCell, setActiveCell] = useState<number | null>(null);
  const [glyph, setGlyph] = useState<string | null>(null);
  const [trialIdx, setTrialIdx] = useState(-1);
  const [nBack, setNBack] = useState(2);
  const [blockNum, setBlockNum] = useState(1);
  const [score, setScore] = useState(0);
  const [fx, setFxState] = useState<{ pos: Fx; snd: Fx }>({ pos: null, snd: null });
  const [interlude, setInterlude] = useState<{ block: number; prevN: number; nextNV: number; acc: number; hits: number; fas: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  /* ---------- engine refs (never touched during render) ---------- */
  const timersRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>('home');
  const nRef = useRef(2);
  const trialRef = useRef(-1);
  const blockNumRef = useRef(1);
  const seqRef = useRef<{ pos: number[]; snd: number[] }>({ pos: [], snd: [] });
  const respRef = useRef<{ pos: boolean; snd: boolean }>({ pos: false, snd: false });
  const statsRef = useRef<{ pos: ChannelStats; snd: ChannelStats }>({ pos: emptyStats(), snd: emptyStats() });
  const sessionRef = useRef<{ mode: 'campaign' | 'practice'; day: number; title: string; startN: number; points: number; blocks: BlockSummary[] }>({
    mode: 'practice', day: 0, title: '', startN: 2, points: 0, blocks: [],
  });
  const soundRef = useRef(true);
  const pressRef = useRef<(ch: Channel) => void>(() => undefined);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /* ---------- timer plumbing ---------- */
  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const setFx = useCallback((ch: Channel, kind: Fx) => {
    setFxState((prev) => ({ ...prev, [ch]: kind }));
    const id = window.setTimeout(() => setFxState((prev) => ({ ...prev, [ch]: null })), 420);
    timersRef.current.push(id);
  }, []);

  /* ---------- response evaluation (independent channels) ---------- */
  const press = useCallback((ch: Channel) => {
    if (phaseRef.current !== 'playing') return;
    const i = trialRef.current;
    const n = nRef.current;
    if (i < n) return; // warm-up trials have no n-back comparison yet — ignore early presses
    if (respRef.current[ch]) return; // one response per channel per window
    respRef.current[ch] = true;
    const seq = seqRef.current;
    const isMatch = ch === 'pos' ? seq.pos[i] === seq.pos[i - n] : seq.snd[i] === seq.snd[i - n];
    const st = statsRef.current[ch];
    if (isMatch) {
      st.hits++;
      sessionRef.current.points += HIT_POINTS * n;
      playBlip('good', soundRef.current);
      setFx(ch, 'hit');
    } else {
      st.fa++;
      sessionRef.current.points -= FA_POINTS * n;
      playBlip('bad', soundRef.current);
      setFx(ch, 'fa');
    }
    setScore(Math.max(0, sessionRef.current.points));
  }, [setFx]);

  useEffect(() => { pressRef.current = press; }, [press]);

  /* keyboard: A = position match, L = sound match (layout-independent via e.code) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (phaseRef.current !== 'playing') return;
      if (e.code === 'KeyA') {
        e.preventDefault();
        pressRef.current('pos');
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        pressRef.current('snd');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* unmount: kill every timer + close the audio graph */
  useEffect(() => {
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
      releaseAudio();
    };
  }, []);

  /* campaign progress from localStorage (deferred: avoids sync setState-in-effect + SSR mismatch) */
  useEffect(() => {
    const id = window.setTimeout(() => setMaxDay(loadMaxDay()), 0);
    return () => window.clearTimeout(id);
  }, []);

  /* ---------- trial engine ---------- */

  /** Window for trial i has ended: register misses on the opportunities. */
  const commitTrial = (i: number) => {
    if (i < 0) return;
    const n = nRef.current;
    if (i < n) return; // warm-up trials carry no opportunities
    const st = statsRef.current;
    const seq = seqRef.current;
    if (seq.pos[i] === seq.pos[i - n] && !respRef.current.pos) st.pos.misses++;
    if (seq.snd[i] === seq.snd[i - n] && !respRef.current.snd) st.snd.misses++;
  };

  const finishSession = () => {
    const s = sessionRef.current;
    const pos = sumStats(s.blocks.map((b) => b.pos));
    const snd = sumStats(s.blocks.map((b) => b.snd));
    const hits = pos.hits + snd.hits;
    const opps = pos.opps + snd.opps;
    const fas = pos.fa + snd.fa;
    const misses = pos.misses + snd.misses;
    const finalScore = Math.max(0, s.points);
    const accPct = opps > 0 ? Math.round((hits / opps) * 100) : 0;
    setScore(finalScore);
    setSummary({ title: s.title, blocks: [...s.blocks], pos, snd, score: finalScore, accPct });
    if (s.mode === 'campaign' && s.day > 0) {
      const prev = loadMaxDay();
      if (s.day > prev) {
        saveMaxDay(s.day);
        setMaxDay(s.day);
      }
    }
    go('results');
    // Economy contract — guests fail gracefully; local results still shown.
    void finish(finalScore, {
      day: s.mode === 'campaign' ? s.day : 0,
      n: s.blocks.length > 0 ? s.blocks[s.blocks.length - 1].n : s.startN,
      hits,
      misses,
      falseAlarms: fas,
      accuracy: accPct,
    });
  };

  const endBlock = () => {
    const n = nRef.current;
    const st = statsRef.current;
    const hits = st.pos.hits + st.snd.hits;
    const opps = st.pos.opps + st.snd.opps;
    const fas = st.pos.fa + st.snd.fa;
    const acc = effectiveAcc(hits, fas, opps);
    sessionRef.current.blocks.push({ n, pos: { ...st.pos }, snd: { ...st.snd }, acc });
    saveLastN(n);
    if (blockNumRef.current < SESSION_BLOCKS) {
      const nn = nextN(n, acc);
      setInterlude({ block: blockNumRef.current, prevN: n, nextNV: nn, acc, hits, fas });
      nRef.current = nn;
      setNBack(nn);
      go('interlude');
      later(() => {
        if (phaseRef.current === 'interlude') startBlock(2);
      }, 5200);
    } else {
      finishSession();
    }
  };

  const runTrial = (i: number, blockLen: number) => {
    commitTrial(i - 1);
    if (i >= blockLen) {
      endBlock();
      return;
    }
    trialRef.current = i;
    respRef.current = { pos: false, snd: false };
    setTrialIdx(i);
    const cell = seqRef.current.pos[i];
    const tone = seqRef.current.snd[i];
    setActiveCell(cell);
    setGlyph(SYNAPSE_LETTERS[tone]);
    playLetter(tone, soundRef.current);
    later(() => {
      setActiveCell(null);
      setGlyph(null);
    }, STIM_MS);
    later(() => runTrial(i + 1, blockLen), TRIAL_MS);
  };

  const startBlock = (num: 1 | 2) => {
    if (phaseRef.current === 'playing') return; // guard: ignore double-activation (button spam / pending auto-continue)
    const n = nRef.current;
    const seq = genBlock(n);
    seqRef.current = { pos: seq.pos, snd: seq.snd };
    statsRef.current = {
      pos: { hits: 0, misses: 0, fa: 0, opps: seq.opps.pos },
      snd: { hits: 0, misses: 0, fa: 0, opps: seq.opps.snd },
    };
    blockNumRef.current = num;
    trialRef.current = -1;
    respRef.current = { pos: false, snd: false };
    setBlockNum(num);
    setTrialIdx(-1);
    setFxState({ pos: null, snd: null });
    go('playing');
    later(() => runTrial(0, BASE_TRIALS + n), 900);
  };

  /* ---------- session lifecycle ---------- */

  const startSession = (mode: 'campaign' | 'practice', day: number, startN: number, title: string) => {
    if (phaseRef.current === 'countdown' || phaseRef.current === 'playing' || phaseRef.current === 'interlude') return; // guard: session already live
    ensureAudio(); // first user gesture — unlock WebAudio for the tones
    soundRef.current = user?.soundOn ?? true;
    sessionRef.current = { mode, day, title, startN, points: 0, blocks: [] };
    nRef.current = mode === 'campaign' ? startN : loadLastN();
    setSession({ mode, day, title });
    setNBack(nRef.current);
    setScore(0);
    setSummary(null);
    setInterlude(null);
    setTrialIdx(-1);
    setActiveCell(null);
    setGlyph(null);
    setCount(3);
    go('countdown');
    sfx.click();
    later(() => { setCount(2); sfx.click(); }, 700);
    later(() => { setCount(1); sfx.click(); }, 1400);
    later(() => startBlock(1), 2100);
  };

  const openDay = (d: SynapseDay) => {
    const act = SYNAPSE_ACTS.find((a) => a.act === d.act);
    setBrief({
      mode: 'campaign',
      day: d.day,
      startN: d.startN,
      title: pick(d.title, locale),
      note: pick(d.note, locale),
      actTitle: act ? `${pick(act.title, locale)} · ${pick(act.range, locale)}` : '',
    });
  };

  const openPractice = () => {
    setBrief({
      mode: 'practice',
      day: 0,
      startN: loadLastN(),
      title: pick(PRACTICE_TITLE, locale),
      note: pick(PRACTICE_BLURB, locale),
      actTitle: locale === 'fa' ? 'خارج از برنامهٔ ۲۰ روزه' : 'Outside the 20-day program',
    });
  };

  const playAgain = () => {
    const s = sessionRef.current;
    startSession(s.mode, s.day, s.startN, s.title);
  };

  const exitAll = () => {
    clearTimers();
    onExit();
  };

  const blockLen = BASE_TRIALS + nBack;
  const trialShown = Math.min(Math.max(trialIdx + 1, 0), blockLen);

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden" dir={isRtl ? 'rtl' : 'ltr'}>
      <style>{SYN_CSS}</style>
      {/* clinical ambience: violet + teal radial washes */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(900px 480px at 18% -5%, rgba(147,51,234,0.16), transparent 60%), radial-gradient(820px 520px at 88% 105%, rgba(20,184,166,0.12), transparent 60%)' }}
      />

      <div className="relative mx-auto w-full max-w-md px-3 pb-10 pt-3 sm:max-w-lg">
        <AnimatePresence mode="wait">
          {/* ============================== HOME / CLINIC MENU ============================== */}
          {phase === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="space-y-4">
              <header className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl border border-white/10 bg-white/5" onClick={exitAll} aria-label={t('back_park')}>
                  <X className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-7 w-7 text-violet-300" />
                  <div>
                    <h1 className="text-xl font-black leading-tight text-violet-100">{t('game_synapse')}</h1>
                    <p className="text-[11px] text-muted-foreground">{t('game_synapse_tag')}</p>
                  </div>
                </div>
              </header>

              <section className="syn-glass rounded-3xl p-5 text-center" aria-label={t('game_synapse_desc')}>
                <p className="mx-auto max-w-sm text-xs leading-relaxed text-white/70">{t('game_synapse_desc')}</p>
                <div className="mt-3 flex flex-col items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-[10px] font-bold tracking-wide text-teal-200" dir="ltr">
                    <FlaskConical className="h-3 w-3" /> Jaeggi et al. 2008 · PNAS
                  </span>
                  <p className="max-w-sm text-[11px] leading-relaxed text-white/50">{pick(SCIENCE_NOTE, locale)}</p>
                </div>
              </section>

              <section className="syn-glass rounded-3xl p-4" aria-label={t('campaign')}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-black text-white/90">
                    <BookOpen className="h-4 w-4 text-amber-300" /> {t('campaign')}
                  </h2>
                  <Badge className="border-white/15 bg-white/5 text-white/70" dir="ltr">{loc(maxDay)} / {loc(20)}</Badge>
                </div>

                {/* act legend */}
                <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
                  {SYNAPSE_ACTS.map((a) => {
                    const need = a.act === 3 ? 20 : a.act * 7;
                    const complete = maxDay >= need;
                    return (
                      <div key={a.act} className={`rounded-xl border px-1.5 py-1.5 ${complete ? 'border-teal-400/30 bg-teal-500/10' : 'border-white/10 bg-white/[0.03]'}`}>
                        <div className={`text-[11px] font-black ${complete ? 'text-teal-200' : 'text-white/80'}`}>{pick(a.title, locale)}</div>
                        <div className="text-[9px] text-white/45">{pick(a.range, locale)}</div>
                      </div>
                    );
                  })}
                </div>

                {/* 20 day cards + practice card (7 per row) */}
                <div className="grid grid-cols-7 gap-1.5" role="list" aria-label={t('synapse_day')}>
                  {SYNAPSE_DAYS.map((d) => {
                    const locked = d.day > maxDay + 1;
                    const done = d.day <= maxDay;
                    const current = d.day === maxDay + 1;
                    return (
                      <button
                        key={d.day}
                        type="button"
                        role="listitem"
                        disabled={locked}
                        onClick={() => { sfx.click(); openDay(d); }}
                        aria-label={`${t('synapse_day')} ${d.day}${locked ? ' 🔒' : ''}`}
                        className={[
                          'pressable relative flex aspect-square items-center justify-center rounded-xl border text-sm font-black transition',
                          locked
                            ? 'cursor-not-allowed border-white/5 bg-white/[0.02] text-white/25'
                            : done
                              ? 'border-teal-400/30 bg-teal-500/10 text-teal-200'
                              : current
                                ? 'border-violet-400/60 bg-violet-500/15 text-violet-100 syn-glow-soft'
                                : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-violet-400/40',
                        ].join(' ')}
                      >
                        {loc(d.day)}
                        {done && <Check className="absolute end-0.5 top-0.5 h-3 w-3 text-teal-300" />}
                        {locked && <Lock className="absolute end-0.5 top-0.5 h-2.5 w-2.5 text-white/30" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="listitem"
                    onClick={() => { sfx.click(); openPractice(); }}
                    aria-label={pick(PRACTICE_TITLE, locale)}
                    className="pressable flex aspect-square items-center justify-center rounded-xl border border-dashed border-teal-400/40 bg-teal-500/[0.07] text-teal-300 transition hover:bg-teal-500/15"
                  >
                    <Dumbbell className="h-4 w-4" />
                  </button>
                </div>

                {/* protocol legend */}
                <div className="mt-3 space-y-1.5 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/70">
                    <Grid3x3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" /> {pick(HOWTO_POS, locale)}
                  </p>
                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/70">
                    <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" /> {pick(HOWTO_SND, locale)}
                  </p>
                </div>
              </section>
            </motion.div>
          )}

          {/* ============================== COUNTDOWN ============================== */}
          {phase === 'countdown' && (
            <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="flex min-h-[78dvh] flex-col items-center justify-center gap-6">
              {session && (
                <Badge className="border-white/10 bg-white/5 px-3 py-1 text-white/70">
                  {session.mode === 'campaign' ? (
                    <span className="flex items-center gap-1.5"><BookOpen className="h-3 w-3" />{t('synapse_day')} {loc(session.day)} · {session.title}</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><Dumbbell className="h-3 w-3" />{pick(PRACTICE_TITLE, locale)}</span>
                  )}
                </Badge>
              )}
              <div key={count} className="syn-count select-none font-black text-violet-200 text-7xl" dir="ltr">{loc(count)}</div>
              <Badge className="border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200">
                <span dir="ltr">n = {loc(nBack)}</span>
              </Badge>
              <p className="text-[11px] text-white/40" dir="ltr">{t('synapse_trial')}: {loc(blockLen)} × {SESSION_BLOCKS}</p>
            </motion.div>
          )}

          {/* ============================== PLAYING ============================== */}
          {phase === 'playing' && (
            <motion.div key="playing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-3">
              {/* HUD */}
              <header className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-white/5" onClick={exitAll} aria-label={t('back_park')}>
                  <X className="h-4 w-4" />
                </Button>
                {session?.mode === 'campaign' ? (
                  <Badge className="border-white/10 bg-white/5 text-[10px] text-white/70">
                    <BookOpen className="me-1 h-3 w-3" />{t('synapse_day')} {loc(session.day)}
                  </Badge>
                ) : (
                  <Badge className="border-white/10 bg-white/5 text-[10px] text-white/70">
                    <Dumbbell className="me-1 h-3 w-3" />{pick(PRACTICE_TITLE, locale)}
                  </Badge>
                )}
                <Badge className="border-violet-400/40 bg-violet-500/15 text-[10px] text-violet-200">
                  <span dir="ltr">n = {loc(nBack)}</span>
                </Badge>
                <Badge className="ms-auto border-amber-400/30 bg-amber-500/10 text-[10px] text-amber-300">
                  {t('score')} {loc(score)}
                </Badge>
              </header>

              {/* block progress + trial countdown ring */}
              <div className="flex items-center gap-2">
                <span className="sr-only">{t('synapse_trial')}</span>
                <span className="min-w-14 text-[11px] font-bold text-white/60" dir="ltr">{loc(trialShown)} / {loc(blockLen)}</span>
                <Progress
                  value={(trialShown / blockLen) * 100}
                  className="h-2 flex-1 bg-white/10 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-teal-400 [&>[data-slot=progress-indicator]]:to-violet-400"
                  aria-label={t('synapse_trial')}
                />
                <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90" aria-hidden="true">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
                  <circle
                    key={`${blockNum}-${trialIdx}`}
                    cx="14" cy="14" r="12" fill="none" stroke="#2dd4bf" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray="75.4"
                    className="syn-drain"
                    style={{ animationDuration: `${TRIAL_MS}ms` }}
                  />
                </svg>
              </div>

              {/* 3×3 grid */}
              <div className="syn-breathe relative mx-auto grid w-full max-w-[330px] grid-cols-3 gap-2.5" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className={`syn-tile aspect-square ${activeCell === i ? 'syn-tile-on' : ''}`}>
                    {activeCell === i && <span key={`${blockNum}-${trialIdx}`} className="syn-pulse" />}
                  </div>
                ))}
              </div>

              {/* screen-reader live region + accessibility glyph */}
              <p className="sr-only" aria-live="polite">
                {trialIdx >= 0 && activeCell !== null ? `${glyph ?? ''} · ${pick(POS_NAMES[activeCell], locale)}` : ''}
              </p>
              <div className="relative flex h-12 items-center justify-center">
                {showGlyph && glyph && (
                  <span dir="ltr" className="select-none font-mono text-3xl font-black tracking-widest text-white/55">{glyph}</span>
                )}
                <button
                  type="button"
                  onClick={() => { sfx.click(); setShowGlyph((v) => !v); }}
                  aria-label={pick(GLYPH_TOGGLE, locale)}
                  aria-pressed={showGlyph}
                  className="pressable absolute end-0 top-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/50 hover:text-white/80"
                >
                  {showGlyph ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>

              {/* screen-reader announcement of press feedback (match / false alarm) */}
              <p className="sr-only" role="status" aria-live="assertive">
                {[
                  fx.pos === 'hit' ? t('synapse_match') : fx.pos === 'fa' ? t('synapse_no_match') : '',
                  fx.snd === 'hit' ? t('synapse_match') : fx.snd === 'fa' ? t('synapse_no_match') : '',
                ].filter(Boolean).join(' · ')}
              </p>

              {/* response buttons (≥56px, thumb-friendly) */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => press('pos')}
                  aria-label={t('synapse_position')}
                  className={[
                    'flex min-h-16 select-none flex-col items-center justify-center gap-0.5 rounded-2xl border font-black transition [touch-action:manipulation]',
                    fx.pos === 'hit'
                      ? 'border-teal-300 bg-teal-400/40 text-teal-100 shadow-[0_0_26px_rgba(45,212,191,0.5)]'
                      : fx.pos === 'fa'
                        ? 'animate-shake border-rose-400/70 bg-rose-500/25 text-rose-100'
                        : 'border-teal-400/40 bg-teal-500/15 text-teal-200 active:scale-[0.97]',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 text-base sm:text-lg">
                    <Grid3x3 className="h-5 w-5" />{t('synapse_position')}
                  </span>
                  <span className="hidden rounded-md border border-white/20 bg-black/30 px-1.5 text-[10px] font-bold text-white/50 sm:inline" dir="ltr">A</span>
                </button>
                <button
                  type="button"
                  onClick={() => press('snd')}
                  aria-label={t('synapse_audio')}
                  className={[
                    'flex min-h-16 select-none flex-col items-center justify-center gap-0.5 rounded-2xl border font-black transition [touch-action:manipulation]',
                    fx.snd === 'hit'
                      ? 'border-violet-300 bg-violet-400/40 text-violet-100 shadow-[0_0_26px_rgba(192,132,252,0.5)]'
                      : fx.snd === 'fa'
                        ? 'animate-shake border-rose-400/70 bg-rose-500/25 text-rose-100'
                        : 'border-violet-400/40 bg-violet-500/15 text-violet-200 active:scale-[0.97]',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 text-base sm:text-lg">
                    <Volume2 className="h-5 w-5" />{t('synapse_audio')}
                  </span>
                  <span className="hidden rounded-md border border-white/20 bg-black/30 px-1.5 text-[10px] font-bold text-white/50 sm:inline" dir="ltr">L</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ============================== INTERLUDE (between blocks) ============================== */}
          {phase === 'interlude' && interlude && (
            <motion.div key="interlude" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.22 }} className="flex min-h-[78dvh] items-center justify-center">
              <div className="syn-glass w-full max-w-sm rounded-3xl p-6 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-teal-300">
                  {pick(INTERLUDE_TITLE, locale)} · {loc(interlude.block)}/{loc(SESSION_BLOCKS)}
                </p>
                <div className="my-2 text-4xl font-black text-violet-200">{loc(Math.round(interlude.acc * 100))}{pctSign}</div>
                <p className="text-[11px] text-white/50">{t('synapse_acc')}</p>
                <div className="my-4 flex items-center justify-center gap-2">
                  <Badge variant="outline" className="border-white/15 text-white/60"><span dir="ltr">n = {loc(interlude.prevN)}</span></Badge>
                  {interlude.nextNV > interlude.prevN ? (
                    <ArrowUp className="h-4 w-4 text-teal-300" aria-label="n+1" />
                  ) : interlude.nextNV < interlude.prevN ? (
                    <ArrowDown className="h-4 w-4 text-rose-300" aria-label="n−1" />
                  ) : (
                    <Minus className="h-4 w-4 text-white/40" aria-label="n" />
                  )}
                  <Badge className="border-violet-400/40 bg-violet-500/15 text-violet-200"><span dir="ltr">n = {loc(interlude.nextNV)}</span></Badge>
                </div>
                <div className="mb-4 flex justify-center gap-2 text-[11px]">
                  <span className="rounded-full border border-teal-400/25 bg-teal-500/10 px-2.5 py-1 text-teal-200">✓ {loc(interlude.hits)}</span>
                  <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-1 text-rose-200">✕ {loc(interlude.fas)}</span>
                </div>
                <Button
                  className="h-12 w-full rounded-2xl bg-violet-500/85 text-base font-black text-white hover:bg-violet-500"
                  onClick={() => { sfx.click(); startBlock(2); }}
                >
                  {pick(CONTINUE_BTN, locale)}
                </Button>
                <p className="mt-2 text-[10px] text-white/40">{pick(CONTINUE_NOTE, locale)}</p>
              </div>
            </motion.div>
          )}

          {/* ============================== RESULTS ============================== */}
          {phase === 'results' && summary && (
            <motion.div key="results" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }} className="space-y-4">
              <header className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-white/10 bg-white/5" onClick={exitAll} aria-label={t('back_park')}>
                  <X className="h-4 w-4" />
                </Button>
                <h2 className="text-sm font-black text-white/90">{t('synapse_session_done')}</h2>
              </header>

              <div className="syn-glass rounded-3xl p-5 text-center">
                <div className="text-5xl font-black gold-text">{loc(summary.score)}</div>
                <p className="mt-1 text-xs text-white/50">{t('score')} · {session?.title ?? ''}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                  <Badge className="border-teal-400/30 bg-teal-500/10 text-teal-200">
                    {t('synapse_acc')} {loc(summary.accPct)}{pctSign}
                  </Badge>
                  <Badge className="border-rose-400/25 bg-rose-500/10 text-rose-200">
                    ✕ {loc(summary.pos.fa + summary.snd.fa)}
                  </Badge>
                </div>
                {/* n progression */}
                <div className="mt-3 flex items-center justify-center gap-1.5" dir="ltr">
                  {summary.blocks.map((b, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-white/30">→</span>}
                      <Badge className="border-violet-400/30 bg-violet-500/10 text-violet-200">
                        <span dir="ltr">n = {loc(b.n)}</span>
                      </Badge>
                    </span>
                  ))}
                </div>
              </div>

              {/* per-channel stats */}
              <div className="grid grid-cols-2 gap-3">
                <ChannelCard
                  title={pick(CHANNEL_POS, locale)}
                  icon={<Grid3x3 className="h-3.5 w-3.5" />}
                  tone="teal"
                  stats={summary.pos}
                  labels={{ hits: pick(STAT_WORDS.hits, locale), misses: pick(STAT_WORDS.misses, locale), falseAlarms: pick(STAT_WORDS.falseAlarms, locale) }}
                />
                <ChannelCard
                  title={pick(CHANNEL_SND, locale)}
                  icon={<Volume2 className="h-3.5 w-3.5" />}
                  tone="violet"
                  stats={summary.snd}
                  labels={{ hits: pick(STAT_WORDS.hits, locale), misses: pick(STAT_WORDS.misses, locale), falseAlarms: pick(STAT_WORDS.falseAlarms, locale) }}
                />
              </div>

              {!user && (
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center text-[11px] leading-relaxed text-white/50">
                  {pick(LOCAL_SAVE_NOTE, locale)}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Button className="h-12 rounded-2xl glow-gold" onClick={() => { sfx.click(); close(); playAgain(); }}>
                  <RotateCcw className="me-1 h-4 w-4" />{t('arcade_again')}
                </Button>
                <Button variant="outline" className="h-12 rounded-2xl" onClick={() => { sfx.click(); setSummary(null); go('home'); }}>
                  {pick(MENU_BTN, locale)}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* briefing dialog (campaign days + practice) */}
      <Dialog open={brief !== null} onOpenChange={(o) => { if (!o) setBrief(null); }}>
        <DialogContent className="syn-glass rounded-3xl sm:max-w-sm" dir={isRtl ? 'rtl' : 'ltr'} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-center text-violet-100">
              <span className="me-1 inline-block">🧠</span>{brief?.title}
            </DialogTitle>
            <DialogDescription className="text-center text-[11px] text-white/45">{brief?.actTitle}</DialogDescription>
          </DialogHeader>
          <p className="min-h-14 text-center text-sm leading-relaxed text-white/75">{brief?.note}</p>
          <div className="flex justify-center">
            <Badge className="border-violet-400/40 bg-violet-500/15 text-violet-200">
              <span dir="ltr">{t('synapse_n_back')}: n = {loc(brief?.startN ?? 2)}</span>
            </Badge>
          </div>
          <Button
            className="glow-purple h-12 w-full rounded-2xl bg-violet-500/85 text-base font-black text-white hover:bg-violet-500"
            onClick={() => {
              const b = brief;
              setBrief(null);
              if (b) startSession(b.mode, b.day, b.startN, b.title);
            }}
          >
            <Play className="me-1.5 h-4 w-4" />{t('synapse_start')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* shared economy result modal */}
      <ArcadeResultModal
        open={open}
        title={t('synapse_session_done')}
        subtitle={session?.mode === 'campaign' ? `${t('synapse_day')} ${loc(session.day)} · ${session.title}` : pick(PRACTICE_TITLE, locale)}
        score={score}
        rewards={rewards}
        emoji="🧠"
        onAgain={() => { close(); playAgain(); }}
        onExit={exitAll}
      />
    </div>
  );
}
