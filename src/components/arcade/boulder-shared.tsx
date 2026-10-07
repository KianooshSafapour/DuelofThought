'use client';

/**
 * Boulder Yard — UNIFIED two-campaign game shell (R12-b merge).
 *
 * One entry, two campaigns inside:
 *   • Campaign 1 «BOULDER YARD»  — quarry theme (classic push puzzles)
 *   • Campaign 2 «BOULDER YARD II» — factory theme (pits & one-way gates)
 * The level select, garage and driver profile are shared; switching happens
 * through CAMPAIGN tabs. Driver wallet/XP/garage stay on the SHARED storage
 * key doi_boulder_garage_v1; per-campaign level progress keeps its original
 * keys (doi_boulder_yard / doi_boulder_yard2) so existing saves survive.
 *
 * Graphics (R12-b): gameplay is a full canvas scene (see boulder-canvas.tsx)
 * with themed terrain, animated machines, particles and day/night tint.
 * Engine: src/lib/game/boulder-engine.ts. Economy: shared /api/arcade.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimationControls } from 'framer-motion';
import { toast } from 'sonner';
import { useApp } from '@/store/app';
import { localizeDigits } from '@/lib/i18n';
import { sfx } from '@/lib/sound';
import { Button } from '@/components/ui/button';
import { ArcadeResultModal, announceArcadeRewards, submitArcade, type ArcadeSubmitResult } from '@/lib/arcade-client';
import { useGameSession } from '@/lib/immersive';
import { RetroBoot } from '@/components/shared/RetroBoot';
import {
  BoulderLevelDef, BoulderGameState, createGame, step, undo as engineUndo, starsFor,
  loadProgress, saveProgress, type Dir, type BoulderProgress, type AbilityKind,
} from '@/lib/game/boulder-engine';
import {
  MACHINES, STAT_KEYS, GarageState, MachineDef, StatKey, loadGarage, saveGarage, freshGarage, getMachine,
  effectiveStats, effectiveStat, upgradeTier, upgradeCost, statCap,
  buyMachine, selectMachine, buyUpgrade, canBuy, completionReward, applyReward, levelProgress,
} from '@/lib/game/boulder-garage';
import { BoulderCanvas, type BoulderCanvasApi, type BoulderTheme } from '@/components/arcade/boulder-canvas';

export interface HelpRow { icon: string; key: string }

/** one playable campaign inside the unified Boulder Yard game */
export interface BoulderCampaignSpec {
  arcadeId: 'boulderyard' | 'boulderyard2';
  /** per-campaign level-progress storage key (kept stable for old saves) */
  storageKey: string;
  levels: BoulderLevelDef[];
  yardSize: number;
  nameKey: string;
  tagKey: string;
  theme: BoulderTheme;
  icon: string;
  helpRows: HelpRow[];
}

export interface BoulderGameCoreProps {
  campaigns: BoulderCampaignSpec[];
  /** which campaign tab starts active (0 = Boulder Yard, 1 = Boulder Yard II) */
  initialCampaign?: number;
  onExit: () => void;
  /* retro boot card */
  bootTitle: string;
  bootSubtitle: string;
  bootAccent: string;
  bootIcon: string;
}

type Phase = 'intro' | 'select' | 'play' | 'garage';

/** per-level machine charges — UI state, reset on every level start/restart */
interface Charges { dig: number; lift: number; cargo: boolean }

/* ================= machine CSS-art (garage + HUD badges) ================= */
function paint(hue: number) {
  return {
    body: `hsl(${hue} 62% 50%)`,
    dark: `hsl(${hue} 58% 34%)`,
    light: `hsl(${hue} 70% 60%)`,
    glass: `hsl(${hue} 45% 84%)`,
  };
}

function Wheel({ style }: { style: React.CSSProperties }) {
  return (
    <div className="absolute rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #78716c, #44403c 55%, #1c1917)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)', ...style }}>
      <div className="absolute rounded-full bg-stone-400/80" style={{ inset: '34%' }} />
    </div>
  );
}

/** Side-view machine sprite for garage cards / HUD badges (facing right). */
export function MachineSprite({ def, className }: { def: MachineDef; className?: string }) {
  const p = paint(def.hue);
  const inner = (() => {
    switch (def.kind) {
      case 'tractor':
        return (
          <>
            <Wheel style={{ left: '6%', bottom: '0%', width: '38%', aspectRatio: '1' }} />
            <Wheel style={{ right: '10%', bottom: '6%', width: '24%', aspectRatio: '1' }} />
            <div className="absolute rounded-[18%]" style={{ left: '18%', right: '6%', bottom: '26%', height: '24%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute rounded-t-[24%]" style={{ left: '24%', bottom: '48%', width: '26%', height: '32%', background: p.light, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.22)' }} />
            <div className="absolute rounded-sm" style={{ left: '33%', bottom: '54%', width: '12%', height: '22%', background: p.glass }} />
            <div className="absolute rounded-full" style={{ left: '16%', bottom: '62%', width: '7%', height: '30%', background: '#57534e' }} />
          </>
        );
      case 'tractor_flat':
        return (
          <>
            <div className="absolute rounded-md" style={{ left: '2%', bottom: '24%', width: '54%', height: '11%', background: '#a8a29e', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.3)' }} />
            <Wheel style={{ left: '8%', bottom: '2%', width: '20%', aspectRatio: '1' }} />
            <Wheel style={{ left: '34%', bottom: '2%', width: '20%', aspectRatio: '1' }} />
            <Wheel style={{ right: '6%', bottom: '2%', width: '24%', aspectRatio: '1' }} />
            <div className="absolute rounded-[20%]" style={{ right: '4%', bottom: '20%', width: '36%', height: '46%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute rounded-sm" style={{ right: '12%', bottom: '46%', width: '20%', height: '30%', background: p.glass, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.25)' }} />
            <div className="absolute rounded-full" style={{ right: '32%', bottom: '52%', width: '6%', height: '34%', background: '#57534e' }} />
          </>
        );
      case 'dozer':
        return (
          <>
            <div className="absolute rounded-full" style={{ left: '4%', right: '16%', bottom: '0%', height: '30%', background: '#292524', boxShadow: 'inset 0 0 0 2px #57534e' }}>
              <div className="absolute rounded-full bg-stone-600" style={{ left: '12%', top: '18%', bottom: '18%', width: '14%' }} />
              <div className="absolute rounded-full bg-stone-600" style={{ left: '42%', top: '18%', bottom: '18%', width: '14%' }} />
              <div className="absolute rounded-full bg-stone-600" style={{ right: '12%', top: '18%', bottom: '18%', width: '14%' }} />
            </div>
            <div className="absolute rounded-[16%]" style={{ left: '12%', right: '26%', bottom: '30%', height: '26%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute rounded-t-[24%]" style={{ left: '18%', bottom: '56%', width: '28%', height: '32%', background: p.light, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.22)' }} />
            <div className="absolute rounded-sm" style={{ left: '27%', bottom: '63%', width: '13%', height: '20%', background: p.glass }} />
            <div className="absolute rounded-[14%]" style={{ right: '0%', bottom: '0%', width: '14%', height: '68%', background: 'linear-gradient(180deg,#e2e8f0,#94a3b8 60%,#64748b)', boxShadow: 'inset -2px 0 0 rgba(0,0,0,0.25)' }} />
            <div className="absolute" style={{ right: '13%', bottom: '40%', width: '15%', height: '8%', background: p.dark }} />
            <div className="absolute" style={{ right: '13%', bottom: '22%', width: '15%', height: '8%', background: p.dark }} />
          </>
        );
      case 'excavator':
        return (
          <>
            <div className="absolute rounded-full" style={{ left: '6%', width: '54%', bottom: '0%', height: '26%', background: '#292524', boxShadow: 'inset 0 0 0 2px #57534e' }}>
              <div className="absolute rounded-full bg-stone-600" style={{ left: '12%', top: '20%', bottom: '20%', width: '16%' }} />
              <div className="absolute rounded-full bg-stone-600" style={{ right: '12%', top: '20%', bottom: '20%', width: '16%' }} />
            </div>
            <div className="absolute rounded-[16%]" style={{ left: '8%', bottom: '26%', width: '46%', height: '32%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute rounded-sm" style={{ left: '34%', bottom: '32%', width: '16%', height: '20%', background: p.glass }} />
            <div className="absolute" style={{ left: '40%', bottom: '52%', width: '34%', height: '9%', background: p.dark, transform: 'rotate(-26deg)', transformOrigin: 'left center' }} />
            <div className="absolute" style={{ left: '68%', bottom: '62%', width: '26%', height: '8%', background: p.body, transform: 'rotate(34deg)', transformOrigin: 'left center' }} />
            <div className="absolute rounded-[20%]" style={{ right: '0%', bottom: '34%', width: '15%', height: '22%', background: 'linear-gradient(180deg,#94a3b8,#475569)', boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.3)' }} />
          </>
        );
      case 'forklift':
        return (
          <>
            <div className="absolute rounded-[18%]" style={{ left: '4%', bottom: '18%', width: '56%', height: '40%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute" style={{ left: '12%', bottom: '58%', width: '6%', height: '30%', background: p.dark }} />
            <div className="absolute" style={{ left: '42%', bottom: '58%', width: '6%', height: '30%', background: p.dark }} />
            <div className="absolute rounded-sm" style={{ left: '10%', bottom: '86%', width: '40%', height: '7%', background: p.dark }} />
            <div className="absolute rounded-sm" style={{ left: '20%', bottom: '34%', width: '24%', height: '18%', background: p.glass }} />
            <div className="absolute" style={{ right: '26%', bottom: '6%', width: '6%', height: '78%', background: '#78716c' }} />
            <div className="absolute" style={{ right: '18%', bottom: '6%', width: '6%', height: '78%', background: '#78716c' }} />
            <div className="absolute" style={{ right: '0%', bottom: '12%', width: '20%', height: '6%', background: '#d6d3d1' }} />
            <div className="absolute" style={{ right: '0%', bottom: '24%', width: '20%', height: '6%', background: '#d6d3d1' }} />
            <Wheel style={{ left: '8%', bottom: '0%', width: '22%', aspectRatio: '1' }} />
            <Wheel style={{ left: '38%', bottom: '0%', width: '22%', aspectRatio: '1' }} />
          </>
        );
      case 'loader':
      default:
        return (
          <>
            <Wheel style={{ left: '8%', bottom: '0%', width: '30%', aspectRatio: '1' }} />
            <Wheel style={{ right: '24%', bottom: '0%', width: '30%', aspectRatio: '1' }} />
            <div className="absolute rounded-[16%]" style={{ left: '10%', right: '26%', bottom: '26%', height: '34%', background: p.body, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.3)' }} />
            <div className="absolute rounded-sm" style={{ left: '18%', bottom: '38%', width: '22%', height: '16%', background: p.glass }} />
            <div className="absolute" style={{ right: '14%', bottom: '52%', width: '16%', height: '7%', background: p.dark }} />
            <div className="absolute" style={{ right: '14%', bottom: '36%', width: '16%', height: '7%', background: p.dark }} />
            <div className="absolute" style={{ right: '0%', bottom: '0%', width: '28%', height: '48%', background: 'linear-gradient(180deg,#e2e8f0,#94a3b8 55%,#64748b)', borderRadius: '10% 10% 42% 42%', boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.25)' }} />
          </>
        );
    }
  })();
  return (
    <div className={className} dir="ltr" aria-hidden>
      <div className="relative h-full w-full" style={{ transform: `scale(${def.size})` }}>
        {inner}
        <div className="absolute bottom-[-4%] left-[10%] right-[6%] h-[6%] rounded-full bg-black/25 blur-[2px]" />
      </div>
    </div>
  );
}

/* ================= garage screen (SHARED across campaigns) ================= */
function GarageScreen({ garage, update, onBack }: {
  garage: GarageState;
  update: (g: GarageState) => void;
  onBack: () => void;
}) {
  const { t, locale } = useApp();
  const money = garage.money;

  const doBuy = (m: MachineDef) => {
    const chk = canBuy(garage, m);
    if (!chk.ok) {
      sfx.bad();
      toast.error(chk.reason === 'money' ? `💵 ${t('g_cant_afford')}` : `🔒 ${t('g_need_level')} ${localizeDigits(m.requiredLevel, locale)}`);
      return;
    }
    const next = buyMachine(garage, m);
    if (!next) return;
    update(next);
    sfx.coin();
    toast.success(`🚜 ${t('g_bought_toast')} — ${t('g_m_' + m.id)}`);
  };

  const doSelect = (m: MachineDef) => {
    update(selectMachine(garage, m.id));
    sfx.click();
    toast.success(`🔧 ${t('g_select_toast')} — ${t('g_m_' + m.id)}`);
  };

  const doUpgrade = (m: MachineDef, stat: StatKey) => {
    const next = buyUpgrade(garage, m, stat);
    if (!next) { sfx.bad(); toast.error(`💵 ${t('g_cant_afford')}`); return; }
    update(next);
    sfx.coin();
    toast.success(`⬆️ ${t('g_upgrade_toast')} — ${t('g_m_' + m.id)}`);
  };

  const statLabel: Record<StatKey, string> = { power: 'g_stat_power', dig: 'g_stat_dig', lift: 'g_stat_lift' };
  const statIcon: Record<StatKey, string> = { power: '💪', dig: '🪣', lift: '🏗️' };

  return (
    <div className="royal-card mx-auto max-w-2xl rounded-3xl p-4 sm:p-5">
      {/* header: money + driver level */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-black gold-text">🚜 {t('g_garage')}</h3>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-300">💵 {localizeDigits(money, locale)}</span>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">🎖️ {t('g_driver_lvl')} {localizeDigits(garage.driverLevel, locale)}</span>
        </div>
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground">{t('g_garage_sub')}</p>
      {/* driver XP bar */}
      <div className="mb-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.round(levelProgress(garage.driverXp) * 100)}%` }} />
        </div>
        <span className="text-[10px] font-bold text-emerald-300">✦ {localizeDigits(garage.driverXp, locale)}</span>
      </div>
      <p className="mb-3 text-[10px] text-muted-foreground/80">{t('g_stats_hint')}</p>

      <div className="nice-scroll max-h-[58dvh] space-y-2.5 overflow-y-auto pe-1">
        {MACHINES.map((m) => {
          const owned = garage.ownedMachines.includes(m.id);
          const selected = garage.selected === m.id;
          const es = effectiveStats(m, garage);
          const levelLocked = garage.driverLevel < m.requiredLevel;
          return (
            <div
              key={m.id}
              className={`rounded-2xl border p-2.5 transition ${
                selected ? 'border-emerald-400/60 bg-emerald-500/[0.07] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]' : owned ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-border/70 bg-muted/20'
              }`}
            >
              <div className="flex gap-2.5">
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-muted/60 to-muted/20">
                  <div className="absolute inset-0 flex items-center justify-center p-1.5">
                    <MachineSprite def={m} className="h-full w-full" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-black">{t('g_m_' + m.id)}</span>
                    {selected && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/40">✓ {t('g_selected')}</span>}
                    {owned && !selected && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">★ {t('owned')}</span>}
                    {!owned && levelLocked && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">🔒 {t('g_need_level')} {localizeDigits(m.requiredLevel, locale)}</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t('g_m_' + m.id + '_d')}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {STAT_KEYS.map((stat) => {
                      const base = m.base[stat];
                      const val = es[stat];
                      return (
                        <span key={stat} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${val > 0 ? 'bg-sky-500/10 text-sky-300 ring-sky-400/30' : 'bg-muted/50 text-muted-foreground/70 ring-border'}`}>
                          {statIcon[stat]} {t(statLabel[stat])} {localizeDigits(val, locale)}
                          {val > base && <span className="text-emerald-400"> ↑</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* actions */}
              {owned ? (
                <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={selected ? 'secondary' : 'default'} className="h-8 flex-1" disabled={selected} onClick={() => doSelect(m)}>
                      {selected ? `✓ ${t('g_selected')}` : `🔑 ${t('g_select')}`}
                    </Button>
                  </div>
                  {STAT_KEYS.map((stat) => {
                    const tier = upgradeTier(garage, m.id, stat);
                    const maxed = m.base[stat] + tier >= statCap(m, stat);
                    const cost = upgradeCost(m, stat, tier);
                    return (
                      <div key={stat} className="flex items-center gap-2 text-[11px]">
                        <span className="w-16 shrink-0 text-muted-foreground">{statIcon[stat]} {t(statLabel[stat])}</span>
                        <span className="flex gap-0.5" aria-hidden>
                          {Array.from({ length: 2 }).map((_, i) => (
                            <span key={i} className={`h-1.5 w-3 rounded-full ${i < tier ? 'bg-emerald-400' : 'bg-muted-foreground/25'}`} />
                          ))}
                        </span>
                        <span className="font-black text-sky-300">{localizeDigits(effectiveStat(m, garage, stat), locale)}</span>
                        {maxed ? (
                          <span className="ms-auto rounded-md bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">{t('g_max')}</span>
                        ) : (
                          <Button size="sm" variant="outline" className="ms-auto h-7 px-2 text-[10px]" disabled={garage.money < cost} onClick={() => doUpgrade(m, stat)}>
                            ⬆ {t('g_upgrade')} · 💵 {localizeDigits(cost, locale)}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-sm font-black text-amber-300">💵 {localizeDigits(m.price, locale)}</span>
                  {levelLocked ? (
                    <span className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">🔒 {t('g_need_level')} {localizeDigits(m.requiredLevel, locale)}</span>
                  ) : (
                    <Button size="sm" className="h-8 glow-gold" disabled={garage.money < m.price} onClick={() => doBuy(m)}>
                      🛒 {t('g_buy')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button variant="ghost" className="mt-3 w-full text-xs" onClick={() => { sfx.click(); onBack(); }}>← {t('back')}</Button>
    </div>
  );
}

/* ============================== game core ============================== */
export function BoulderGameCore({ campaigns, initialCampaign = 0, onExit, bootTitle, bootSubtitle, bootAccent, bootIcon }: BoulderGameCoreProps) {
  const { t, locale, user, perfMode } = useApp();
  useGameSession(); // immersive mode: hides platform chrome + fullscreen on touch
  const [booted, setBooted] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [campaignIdx, setCampaignIdx] = useState(() => Math.max(0, Math.min(initialCampaign, campaigns.length - 1)));
  const [garageFrom, setGarageFrom] = useState<'intro' | 'select'>('intro');
  const [levelIdx, setLevelIdx] = useState(0);
  const [game, setGame] = useState<BoulderGameState | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, BoulderProgress>>({});
  const [garage, setGarage] = useState<GarageState>(freshGarage); // hydrated from localStorage below
  const [abil, setAbil] = useState<Charges>({ dig: 0, lift: 0, cargo: false });
  const [celebrate, setCelebrate] = useState<null | { stars: 1 | 2 | 3; pushes: number; par: number; last: boolean; money: number; xp: number; levelUp: number }>(null);
  const [finalModal, setFinalModal] = useState<{ score: number; rewards: ArcadeSubmitResult | null } | null>(null);
  const [tile, setTile] = useState(40);
  const submittedRef = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);

  /* refs mirror the latest state so every handler is synchronous & stable */
  const campRef = useRef(campaignIdx);
  const gameRef = useRef<BoulderGameState | null>(null);
  const garageRef = useRef<GarageState | null>(null);
  const progressRef = useRef<Record<string, BoulderProgress>>({});
  const abilRef = useRef<Charges>({ dig: 0, lift: 0, cargo: false });
  /** charges/cargo snapshot indexed by engine history length (undo-safe) */
  const abilSnap = useRef<Charges[]>([]);
  const shakeCtl = useAnimationControls();
  const canvasApi = useRef<BoulderCanvasApi | null>(null);

  const rtl = locale === 'fa' || locale === 'ar';
  const camp = campaigns[campaignIdx];
  const campLevels = camp.levels;

  /* --- persistence load (garage SHARED; per-campaign level progress) --- */
  useEffect(() => {
    Promise.resolve().then(() => {
      const g = loadGarage();
      garageRef.current = g;
      setGarage(g);
      const map: Record<string, BoulderProgress> = {};
      for (const c of campaigns) map[c.storageKey] = loadProgress(c.storageKey);
      progressRef.current = map;
      setProgressMap(map);
    });
  }, []);

  const updateGarage = useCallback((g: GarageState) => {
    garageRef.current = g;
    setGarage(g);
    saveGarage(g);
  }, []);

  const applyAbil = useCallback((c: Charges) => {
    abilRef.current = c;
    setAbil(c);
  }, []);

  const selDef: MachineDef = getMachine(garage.selected ?? 'tractor_old');
  const es = useMemo(() => effectiveStats(selDef, garage), [selDef, garage]);
  const digMax = es.dig;
  const liftMax = es.lift;

  const resetCharges = useCallback(() => {
    const g = garageRef.current;
    const m = getMachine(g ? g.selected : 'tractor_old');
    const stats = g ? effectiveStats(m, g) : { power: 1, dig: 0, lift: 0 };
    const init: Charges = { dig: stats.dig, lift: stats.lift, cargo: false };
    abilSnap.current = [init];
    applyAbil(init);
  }, [applyAbil]);

  /* responsive tile size (measured on the full-width wrapper) */
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el || !game) return;
    const measure = () => {
      const w = el.clientWidth;
      const size = Math.max(24, Math.min(56, Math.floor((w - 24) / game.cols)));
      setTile(size);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [game?.cols, game, phase]);

  /* ---------- progress helpers (both campaigns) ---------- */
  const progressFor = useCallback((c: BoulderCampaignSpec): BoulderProgress => progressMap[c.storageKey] ?? { unlocked: 0, stars: {} }, [progressMap]);

  const totalStars = useMemo(
    () => campaigns.reduce((acc, c) => acc + Object.values(progressFor(c).stars).reduce((a, b) => a + b, 0), 0),
    [campaigns, progressFor],
  );
  const totalMaxStars = useMemo(() => campaigns.reduce((acc, c) => acc + c.levels.length * 3, 0), [campaigns]);
  const campaignPct = useCallback(
    (c: BoulderCampaignSpec) => {
      const p = progressFor(c);
      const stars = Object.values(p.stars).reduce((a, b) => a + b, 0);
      return Math.round((stars / (c.levels.length * 3)) * 100);
    },
    [progressFor],
  );

  const switchCampaign = useCallback((idx: number) => {
    setCampaignIdx(idx);
    campRef.current = idx;
    sfx.click();
  }, []);

  const startLevel = useCallback((idx: number) => {
    submittedRef.current = false;
    setLevelIdx(idx);
    const g = createGame(campaigns[campRef.current].levels[idx], idx);
    gameRef.current = g;
    setGame(g);
    resetCharges();
    setCelebrate(null);
    setPhase('play');
    sfx.click();
  }, [campaigns, resetCharges]);

  const restart = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    const ng = createGame(campaigns[campRef.current].levels[g.levelIndex], g.levelIndex);
    gameRef.current = ng;
    setGame(ng);
    resetCharges();
    sfx.click();
  }, [campaigns, resetCharges]);

  const doUndo = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.history.length === 0) return;
    const u = engineUndo(g);
    gameRef.current = u;
    setGame(u);
    const restored = abilSnap.current[u.history.length];
    if (restored) applyAbil(restored);
    sfx.click();
  }, [applyAbil]);

  /* invalid ability feedback: shake + buzz (skipped in perf mode) */
  const invalidFx = useCallback(() => {
    sfx.bad();
    if (!perfMode) void shakeCtl.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.3 } });
  }, [perfMode, shakeCtl]);

  /* solve flow: stars, progress persist, driver rewards, shared-economy submit */
  const onSolve = useCallback(async (pushes: number, idx: number) => {
    const c = campaigns[campRef.current];
    const par = c.levels[idx].par;
    const stars = starsFor(pushes, par);
    sfx.win();
    canvasApi.current?.burst();
    canvasApi.current?.popup(`+${stars}★`, true);
    const isLast = idx === c.levels.length - 1;

    /* driver rewards (shared garage wallet across both campaigns) */
    const prevP = progressRef.current[c.storageKey] ?? { unlocked: 0, stars: {} };
    const firstClear = (prevP.stars[idx] ?? 0) === 0;
    const reward = completionReward(idx + 1, stars, firstClear);
    let levelUp = 0;
    if (garageRef.current) {
      const res = applyReward(garageRef.current, reward);
      levelUp = res.levelUp;
      updateGarage(res.garage);
    }
    if (levelUp > 0) {
      sfx.levelup();
      toast.success(`🎖️ ${t('g_levelup_toast')}`);
    }

    /* per-campaign progress persist (sequential unlock: N ⇒ N+1) */
    const next: BoulderProgress = {
      unlocked: Math.max(prevP.unlocked, Math.min(idx + 1, c.levels.length - 1)),
      stars: { ...prevP.stars, [idx]: Math.max(prevP.stars[idx] ?? 0, stars) },
    };
    progressRef.current = { ...progressRef.current, [c.storageKey]: next };
    setProgressMap({ ...progressRef.current });
    saveProgress(c.storageKey, next);

    setCelebrate({ stars, pushes, par, last: isLast, money: reward.money, xp: reward.xp, levelUp });

    if (submittedRef.current) return;
    submittedRef.current = true;
    const score = 100 * (idx + 1) + 50 * stars + Math.max(0, par * 3 - pushes) * 5;
    if (isLast) {
      const rewards = user ? await submitArcade(c.arcadeId, score, { level: idx + 1, stars, pushes }) : null;
      setFinalModal({ score, rewards });
      setCelebrate(null);
    } else if (user) {
      const r = await submitArcade(c.arcadeId, score, { level: idx + 1, stars, pushes });
      if (r) announceArcadeRewards(r);
    }
  }, [campaigns, user, t, updateGarage]);

  /* move handler (gameRef pattern — always synchronous) */
  const move = useCallback((dir: Dir) => {
    const g = gameRef.current;
    if (!g || g.solved) return;
    const r = step(g, dir, { power: es.power });
    if (!r.moved) {
      /* push resistance: wobble when a boulder blocks the way */
      const dv = dir === 'U' ? -g.cols : dir === 'D' ? g.cols : dir === 'L' ? -1 : 1;
      if (g.boulders.has(g.player + dv)) {
        canvasApi.current?.bump(dir);
        sfx.bad();
      }
      return;
    }
    if (r.pushed) {
      sfx.drop();
      if (r.chain > 1) canvasApi.current?.popup(`×${localizeDigits(r.chain, locale)}`, true);
    } else {
      sfx.click();
    }
    const next: Charges = { ...abilRef.current };
    abilSnap.current[r.state.history.length] = next;
    applyAbil(next);
    gameRef.current = r.state;
    setGame(r.state);
    if (r.state.solved) void onSolve(r.state.pushes, r.state.levelIndex);
  }, [onSolve, applyAbil, es.power, locale]);

  /* machine abilities (dig / grab / drop) — charges live here, not in engine snapshots */
  const doAbility = useCallback((kind: AbilityKind) => {
    const g = gameRef.current;
    if (!g || g.solved) return;
    const gar = garageRef.current;
    if (!gar) return;
    const m = getMachine(gar.selected);
    const stats = effectiveStats(m, gar);
    const a = abilRef.current;
    if (kind === 'dig' && (stats.dig <= 0 || a.dig <= 0)) return invalidFx();
    if (kind === 'grab' && (stats.lift <= 0 || a.lift <= 0 || a.cargo)) return invalidFx();
    if (kind === 'drop' && !a.cargo) return invalidFx();
    const r = step(g, g.facing, { ability: kind });
    if (!r.moved) return invalidFx(); // invalid target: no charge consumed
    const next: Charges = {
      dig: a.dig - (kind === 'dig' ? 1 : 0),
      lift: a.lift - (kind === 'grab' ? 1 : 0), // grab consumes a charge; drop is free
      cargo: kind === 'grab' ? true : kind === 'drop' ? false : a.cargo,
    };
    abilSnap.current[r.state.history.length] = next;
    applyAbil(next);
    gameRef.current = r.state;
    setGame(r.state);
    if (kind === 'dig') sfx.drop(); else sfx.capture();
    if (r.state.solved) void onSolve(r.state.pushes, r.state.levelIndex);
  }, [onSolve, applyAbil, invalidFx]);

  const doDig = useCallback(() => doAbility('dig'), [doAbility]);
  const doGrab = useCallback(() => doAbility('grab'), [doAbility]);
  const doDrop = useCallback(() => doAbility('drop'), [doAbility]);

  /* keyboard */
  useEffect(() => {
    if (phase !== 'play' || celebrate) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
        w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L',
      };
      const dir = map[e.key];
      if (dir) { e.preventDefault(); move(dir); return; }
      if (e.key === 'D') { e.preventDefault(); doDig(); return; } // ⇧D = dig ('d' stays "move right")
      if (e.key === 'g' || e.key === 'G') { e.preventDefault(); doGrab(); return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); doDrop(); return; }
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); doUndo(); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, celebrate, move, doUndo, restart, doDig, doGrab, doDrop]);

  /* swipe */
  const onTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    touchStart.current = { x: t0.clientX, y: t0.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t1 = e.changedTouches[0];
    const dx = t1.clientX - touchStart.current.x;
    const dy = t1.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'R' : 'L');
    else move(dy > 0 ? 'D' : 'U');
  };

  /* ---------------- render ---------------- */
  if (!booted) {
    return <RetroBoot title={bootTitle} subtitle={bootSubtitle} accent={bootAccent} cartridgeIcon={bootIcon} onDone={() => setBooted(true)} />;
  }

  const yardGroup = game ? Math.floor(game.levelIndex / camp.yardSize) : 0;

  /* campaign tab strip (used by intro + level select) */
  const campaignTabs = (
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t('by_campaigns')}>
      {campaigns.map((c, i) => {
        const active = i === campaignIdx;
        const pct = campaignPct(c);
        const stars = Object.values(progressFor(c).stars).reduce((a, b) => a + b, 0);
        return (
          <button
            key={c.arcadeId}
            role="tab"
            aria-selected={active}
            onClick={() => switchCampaign(i)}
            className={`flex flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 transition ${
              active
                ? 'border-amber-400/70 bg-gradient-to-b from-amber-500/15 to-amber-500/5 shadow-[0_0_0_1px_rgba(251,191,36,0.3)]'
                : 'border-border/60 bg-muted/20 hover:border-amber-500/40'
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-black">
              <span className="text-base">{c.icon}</span>
              <span className={active ? 'gold-text' : 'text-foreground/80'}>{t(c.nameKey)}</span>
            </span>
            <span className="text-[10px] font-bold text-muted-foreground">
              {c.theme === 'quarry' ? `⛰ ${t('by_theme_quarry')}` : `🏭 ${t('by_theme_factory')}`} · ⭐ {localizeDigits(stars, locale)}/{localizeDigits(c.levels.length * 3, locale)} · {localizeDigits(pct, locale)}%
            </span>
          </button>
        );
      })}
    </div>
  );

  const boardNode = game && tile > 0 && (
    <div ref={boardWrapRef} className="w-full">
      <div
        dir="ltr"
        className={`mx-auto w-max touch-none rounded-xl border-2 p-1.5 shadow-xl ${camp.theme === 'quarry' ? 'border-amber-700/40 bg-gradient-to-br from-[#2a2118] to-[#1c1610]' : 'border-slate-500/40 bg-gradient-to-br from-[#141a22] to-[#0b0f14]'}`}
        style={{ padding: 6 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="application"
        aria-label={t(camp.nameKey)}
      >
        <BoulderCanvas
          game={game}
          theme={camp.theme}
          hue={selDef.hue}
          kind={selDef.kind}
          machineScale={selDef.size}
          cargo={abil.cargo}
          perf={perfMode}
          tile={tile}
          yardGroup={yardGroup}
          levelIndex={game.levelIndex}
          apiRef={canvasApi}
        />
      </div>
    </div>
  );

  const dpad = (
    <div className="mx-auto grid w-max grid-cols-3 gap-1.5" aria-hidden>
      <span />
      <Button variant="outline" className="h-12 w-12 p-0 text-lg" onClick={() => move('U')} aria-label="up">▲</Button>
      <span />
      <Button variant="outline" className="h-12 w-12 p-0 text-lg" onClick={() => move('L')} aria-label="left">◀</Button>
      <Button variant="outline" className="h-12 w-12 p-0 text-[10px]" onClick={doUndo} aria-label="undo">↺</Button>
      <Button variant="outline" className="h-12 w-12 p-0 text-lg" onClick={() => move('R')} aria-label="right">▶</Button>
      <span />
      <Button variant="outline" className="h-12 w-12 p-0 text-lg" onClick={() => move('D')} aria-label="down">▼</Button>
      <span />
    </div>
  );

  /* ability buttons — only for machines that own the charges (≥56px touch) */
  const abilityBtn = 'h-14 min-w-[64px] flex-col gap-0.5 rounded-xl p-1 text-[10px] font-bold leading-none';
  const abilities = (
    <div className="flex flex-col gap-2" aria-label="machine abilities">
      {digMax > 0 && (
        <Button variant="outline" className={abilityBtn} disabled={abil.dig <= 0} onClick={doDig} aria-label={t('g_dig')}>
          <span className="text-xl leading-none">🪣</span>
          <span>{t('g_dig')} · {localizeDigits(abil.dig, locale)}</span>
        </Button>
      )}
      {liftMax > 0 && (
        <Button variant="outline" className={`${abilityBtn} ${abil.cargo ? 'border-violet-400/70 bg-violet-500/10' : ''}`} disabled={abil.lift <= 0 && !abil.cargo} onClick={abil.cargo ? doDrop : doGrab} aria-label={abil.cargo ? t('g_drop') : t('g_grab')}>
          <span className="text-xl leading-none">{abil.cargo ? '📦' : '🏗️'}</span>
          <span>{abil.cargo ? t('g_drop') : t('g_grab')}{!abil.cargo && abil.lift > 0 ? ` · ${localizeDigits(abil.lift, locale)}` : ''}</span>
        </Button>
      )}
    </div>
  );
  const hasAbilities = digMax > 0 || liftMax > 0;

  /* machine chips for the in-game HUD */
  const machineChips = (
    <>
      <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/30">
        <span className="inline-block h-4 w-7 shrink-0"><MachineSprite def={selDef} /></span>
        <span className="max-w-28 truncate">{t('g_m_' + selDef.id)}</span>
      </span>
      {digMax > 0 && (
        <span className="rounded-lg bg-sky-500/10 px-2 py-1 text-xs font-bold text-sky-300 ring-1 ring-sky-400/30">🪣 {localizeDigits(abil.dig, locale)}</span>
      )}
      {liftMax > 0 && (
        <span className="rounded-lg bg-violet-500/10 px-2 py-1 text-xs font-bold text-violet-300 ring-1 ring-violet-400/30">🏗️ {localizeDigits(abil.lift, locale)}</span>
      )}
      {abil.cargo && (
        <span className="rounded-lg bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">📦 {t('g_cargo')}</span>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-3xl px-3 py-4" dir={rtl ? 'rtl' : 'ltr'}>
      {/* ---------- intro (unified menu) ---------- */}
      {phase === 'intro' && (
        <div className="royal-card mx-auto max-w-md rounded-3xl p-6 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400/30 to-emerald-700/30 text-3xl shadow-lg ring-1 ring-emerald-400/40">
            {camp.icon}
          </div>
          <h2 className="gold-text text-2xl font-black">{t(camp.nameKey)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t(camp.tagKey)}</p>
          {/* total stars across BOTH campaigns + driver chip */}
          <div className="mx-auto mt-3 flex w-max items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs">
            <span className="font-black text-amber-300">⭐ {localizeDigits(totalStars, locale)}/{localizeDigits(totalMaxStars, locale)}</span>
            <span className="text-muted-foreground">· {t('by_stars_total')}</span>
          </div>
          <div className="mx-auto mt-2 flex w-max items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs">
            <span className="inline-block h-5 w-9"><MachineSprite def={selDef} /></span>
            <span className="font-bold text-emerald-300">{t('g_m_' + selDef.id)}</span>
            <span className="text-muted-foreground">· 🎖️ {localizeDigits(garage.driverLevel, locale)} · 💵 {localizeDigits(garage.money, locale)}</span>
          </div>
          <div className="mt-4">{campaignTabs}</div>
          {/* selected-campaign progress */}
          <p className="mt-3 text-xs text-muted-foreground">
            {t('by_progress')}: <b className="text-foreground">{localizeDigits(campaignPct(camp), locale)}%</b>
            {' · '}{localizeDigits(campLevels.length, locale)} {t('by_levels')}
            {progressFor(camp).unlocked > 0 && ` · ${t('by_best')}: ${t('by_level')} ${localizeDigits(progressFor(camp).unlocked + 1, locale)}`}
          </p>
          <div className="mt-3 space-y-2 text-start">
            {camp.helpRows.map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                <span className="text-base">{h.icon}</span>
                <span>{t(h.key)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1 glow-gold" onClick={() => startLevel(Math.min(progressFor(camp).unlocked, campLevels.length - 1))}>
              ▶ {progressFor(camp).unlocked > 0 ? t('by_continue') : t('by_start')}
            </Button>
            <Button variant="outline" onClick={() => { setPhase('select'); sfx.click(); }}>{t('by_levels')}</Button>
          </div>
          <Button variant="outline" className="mt-2 w-full" onClick={() => { setGarageFrom('intro'); setPhase('garage'); sfx.click(); }}>🚜 {t('g_open_garage')}</Button>
          <Button variant="ghost" className="mt-2 text-xs text-muted-foreground" onClick={() => { sfx.click(); onExit(); }}>
            ← {t('back_park')}
          </Button>
        </div>
      )}

      {/* ---------- level select (per-campaign list, shared garage) ---------- */}
      {phase === 'select' && (
        <div className="royal-card mx-auto max-w-lg rounded-3xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-black gold-text">{t('by_levels')}</h3>
            <Badge>⭐ {localizeDigits(totalStars, locale)}/{localizeDigits(totalMaxStars, locale)}</Badge>
          </div>
          {campaignTabs}
          {/* machine slot (shared garage) */}
          <div className="mt-3 mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2">
            <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">{t('g_machine_slot')}</span>
            <span className="inline-block h-7 w-12 shrink-0"><MachineSprite def={selDef} /></span>
            <span className="truncate text-sm font-black text-emerald-300">{t('g_m_' + selDef.id)}</span>
            <Button variant="ghost" size="sm" className="ms-auto h-8 shrink-0 text-xs" onClick={() => { setGarageFrom('select'); setPhase('garage'); sfx.click(); }}>🔧 {t('g_change')}</Button>
          </div>
          <div className="nice-scroll max-h-[52dvh] space-y-4 overflow-y-auto pe-1">
            {[1, 2, 3].map((yard) => (
              <div key={yard}>
                <div className="mb-1.5 text-xs font-bold text-muted-foreground">{t('by_yard')} {localizeDigits(yard, locale)}</div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                  {campLevels.slice((yard - 1) * camp.yardSize, yard * camp.yardSize).map((_, i) => {
                    const idx = (yard - 1) * camp.yardSize + i;
                    const p = progressFor(camp);
                    const locked = idx > p.unlocked;
                    const st = p.stars[idx] ?? 0;
                    return (
                      <button
                        key={idx}
                        disabled={locked}
                        onClick={() => startLevel(idx)}
                        className={`flex h-14 flex-col items-center justify-center rounded-xl border text-sm font-black transition ${
                          locked ? 'border-border/50 bg-muted/30 text-muted-foreground/50' : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-400 hover:bg-amber-500/20'
                        }`}
                        aria-label={`${t('by_level')} ${idx + 1}${locked ? ' 🔒' : ''}`}
                      >
                        <span>{locked ? '🔒' : localizeDigits(idx + 1, locale)}</span>
                        {!locked && <span className="text-[9px] leading-none">{'⭐'.repeat(st) || '·'}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="mt-3 w-full text-xs" onClick={() => { setPhase('intro'); sfx.click(); }}>← {t('back')}</Button>
        </div>
      )}

      {/* ---------- garage (shared across campaigns) ---------- */}
      {phase === 'garage' && (
        <GarageScreen garage={garage} update={updateGarage} onBack={() => { setPhase(garageFrom); sfx.click(); }} />
      )}

      {/* ---------- play ---------- */}
      {phase === 'play' && game && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-black">
              <span className="rounded-lg bg-gradient-to-r from-amber-500/20 to-amber-500/5 px-2 py-1 text-amber-300 ring-1 ring-amber-500/30">{camp.icon} {t('by_level')} {localizeDigits(game.levelIndex + 1, locale)}</span>
              <span className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
                {t('by_pushes')}: {localizeDigits(game.pushes, locale)} / {t('by_par')} {localizeDigits(campLevels[game.levelIndex].par, locale)}
              </span>
              {machineChips}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-9" onClick={restart}>⟳ {t('by_restart')}</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => { setPhase('select'); setGame(null); gameRef.current = null; sfx.click(); }}>☰ {t('by_levels')}</Button>
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { sfx.click(); onExit(); }}>✕</Button>
            </div>
          </div>
          <motion.div animate={shakeCtl} className="mx-auto w-max max-w-full">
            {boardNode}
          </motion.div>
          <div className="mt-4 flex items-start justify-center gap-3 sm:gap-6">
            {dpad}
            {hasAbilities && abilities}
          </div>
          <p className="mt-3 hidden text-center text-[10px] text-muted-foreground md:block">
            {t('by_keys_hint')}
          </p>
          {hasAbilities && (
            <p className="mt-1 hidden text-center text-[10px] text-muted-foreground md:block">
              {t('g_keys_abilities')}
            </p>
          )}
        </div>
      )}

      {/* ---------- solve celebration ---------- */}
      <AnimatePresence>
        {celebrate && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="royal-card w-full max-w-xs rounded-3xl p-6 text-center"
              initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
              <div className="text-4xl">🎉</div>
              <h3 className="mt-2 text-xl font-black gold-text">{t('by_solved')}</h3>
              <div className="my-3 flex justify-center gap-1.5">
                {[1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    className={`text-4xl ${i <= celebrate.stars ? '' : 'opacity-25 grayscale'}`}
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.15 * i, type: 'spring', stiffness: 300, damping: 12 }}
                  >⭐</motion.span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('by_pushes')}: <b className="text-foreground">{localizeDigits(celebrate.pushes, locale)}</b> · {t('by_par')}: {localizeDigits(celebrate.par, locale)}
              </p>
              <p className="mt-1.5 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                {t('g_earned')}: 💵 +{localizeDigits(celebrate.money, locale)} · ✦ +{localizeDigits(celebrate.xp, locale)}
              </p>
              {celebrate.levelUp > 0 && (
                <p className="mt-1 text-xs font-black text-amber-300">🎖️ {t('g_levelup_toast')}</p>
              )}
              {!celebrate.last && (
                <Button className="mt-4 w-full glow-gold" onClick={() => startLevel(Math.min(levelIdx + 1, campLevels.length - 1))}>
                  {t('by_next')} →
                </Button>
              )}
              <Button variant="outline" className="mt-2 w-full" onClick={() => { setCelebrate(null); setPhase('select'); setGame(null); gameRef.current = null; sfx.click(); }}>
                ☰ {t('by_levels')}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* campaign finale — shared result modal */}
      <ArcadeResultModal
        open={!!finalModal}
        title={t('by_campaign_done')}
        subtitle={t('by_yard_done')}
        score={finalModal?.score ?? 0}
        rewards={finalModal?.rewards ?? null}
        emoji="🏆"
        onAgain={() => { setFinalModal(null); setPhase('select'); }}
        onExit={() => { setFinalModal(null); onExit(); }}
      />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-300">{children}</span>;
}
