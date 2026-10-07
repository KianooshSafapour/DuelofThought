'use client';

/**
 * HubView — premium "games park" landing: cinematic hero banner (Duel of Ideas
 * key art), featured duel card, Science Arcade strip, research note, daily
 * quests widget, announcements, daily check-in streak calendar.
 * Missing art degrades to gradient blocks — never crashes.
 */
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { localizeDigits } from '@/lib/i18n';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import {
  Play, Sparkles, ScrollText, Megaphone, Trophy, FlaskConical, Rocket, BrainCircuit, Star, CalendarCheck, Coins as CoinsIcon, Crosshair, Mountain, Boxes,
} from 'lucide-react';

interface QuestRow { id: string; questId: string; progress: number; goal: number; reward: number; claimed: boolean }
interface Ann { id: string; titleFa: string; titleEn: string; titleAr: string; titleTr: string; bodyFa: string; bodyEn: string; bodyAr: string; bodyTr: string; kind: string }
interface CheckinStatus { auth: boolean; claimedToday?: boolean; streak?: number; nextDay?: number; nextReward?: number; rewards?: number[] }

/** next/image cover that degrades to a rich gradient block if the file is missing. */
function CoverImage({ src, sizes, priority, imgClass }: { src: string; sizes: string; priority?: boolean; imgClass?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="absolute inset-0 bg-gradient-to-br from-amber-500/30 via-fuchsia-600/20 to-sky-600/25" aria-hidden />;
  }
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      priority={priority}
      onError={() => setFailed(true)}
      className={imgClass ?? 'object-cover'}
    />
  );
}

const riseIn = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
} as const;

export function HubView() {
  const { t, locale, user, setView, setGameSettings } = useApp();
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);

  useEffect(() => {
    api.get<{ quests: QuestRow[] }>('/api/quests').then((d) => setQuests(d.quests)).catch(() => undefined);
    api.get<{ announcements: Ann[] }>('/api/announcements').then((d) => setAnns(d.announcements)).catch(() => undefined);
    api.get<CheckinStatus>('/api/checkin').then(setCheckin).catch(() => undefined);
  }, [user?.id]);

  const pick = (ann: Ann) => ({ fa: ann.titleFa, en: ann.titleEn, ar: ann.titleAr, tr: ann.titleTr })[locale];
  const pickBody = (ann: Ann) => ({ fa: ann.bodyFa, en: ann.bodyEn, ar: ann.bodyAr, tr: ann.bodyTr })[locale];

  /* Science Arcade strip — covers live in /public/art; clicks hand off to ArcadeView */
  const arcadeGames = [
    { id: 'orbit', cover: '/art/orbit-cover.jpg', name: t('game_orbit'), tag: t('game_orbit_tag'), icon: <Rocket className="h-4 w-4" /> },
    { id: 'synapse', cover: '/art/synapse-cover.jpg', name: t('game_synapse'), tag: t('game_synapse_tag'), icon: <BrainCircuit className="h-4 w-4" /> },
    { id: 'stellar', cover: '/art/stellar-cover.jpg', name: t('game_stellar'), tag: t('game_stellar_tag'), icon: <Star className="h-4 w-4" /> },
    { id: 'mazemind', cover: '/art/mazemind-cover.jpg', name: t('game_mazemind'), tag: t('game_mazemind_tag'), icon: <Crosshair className="h-4 w-4" /> },
    { id: 'boulderyard', cover: '/art/boulderyard-cover.jpg', name: t('game_boulderyard'), tag: t('game_boulderyard_tag'), icon: <Mountain className="h-4 w-4" /> },
    { id: 'boulderyard2', cover: '/art/boulderyard2-cover.jpg', name: t('game_boulderyard2'), tag: t('game_boulderyard2_tag'), icon: <Boxes className="h-4 w-4" /> },
  ];

  const claim = async (q: QuestRow) => {
    if (q.claimed || q.progress < q.goal) return;
    try {
      const res = await api.post<{ reward: number; coins: number }>('/api/quests', { questId: q.questId });
      sfx.coin();
      toast.success(`+${localizeDigits(res.reward, locale)} 🪙`);
      setQuests((qs) => qs.map((x) => (x.questId === q.questId ? { ...x, claimed: true } : x)));
      useApp.getState().refreshSession();
    } catch {
      toast.error(t('error'));
    }
  };

  const claimCheckin = async () => {
    if (!checkin || checkin.claimedToday || !checkin.auth) return;
    try {
      const res = await api.post<{ reward: number; streak: number; jackpot: boolean }>('/api/checkin', {});
      sfx.coin();
      if (res.jackpot) { sfx.achievement(); toast.success(`👑 +${localizeDigits(res.reward, locale)} 🪙`); }
      else toast.success(`+${localizeDigits(res.reward, locale)} 🪙`);
      setCheckin((c) => c ? { ...c, claimedToday: true, streak: res.streak } : c);
      useApp.getState().refreshSession();
    } catch {
      toast.error(t('error'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10">
      {/* ---------- hero: cinematic banner ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="royal-card card-shine relative mt-4 overflow-hidden rounded-3xl"
      >
        {/* banner art + legibility gradient + soft shimmer sweep */}
        <div className="absolute inset-0" aria-hidden>
          <CoverImage src="/art/duel-hero.jpg" sizes="(max-width: 896px) 100vw, 896px" priority />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
          <div className="shimmer absolute inset-0 opacity-25 motion-reduce:hidden" />
        </div>

        {/* floating company badge */}
        <div className="absolute start-3 top-3 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 backdrop-blur-md sm:start-4 sm:top-4">
          <img src="/brand/logo.png" alt="" className="h-5 w-5 rounded-md object-cover ring-1 ring-amber-400/40" />
          <span className="leading-tight">
            <span className="block text-[10px] font-black text-foreground/90 sm:text-[11px]">{t('company')}</span>
            <span className="block text-[8px] text-muted-foreground sm:text-[9px]" dir="ltr">{t('company_en')}</span>
          </span>
        </div>

        {/* hero copy, anchored to the bottom edge (RTL-safe) */}
        <div className="relative z-10 flex min-h-44 flex-col justify-end gap-1.5 p-4 pt-12 sm:min-h-64 sm:gap-2.5 sm:p-6 sm:pt-16 lg:min-h-72">
          <h1 className="text-2xl font-black leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] sm:text-4xl">
            <span className="gold-text">{t('hub_hero_title')}</span>
          </h1>
          <p className="max-w-xl text-xs leading-relaxed text-foreground/85 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] sm:text-base">
            {t('hub_hero_sub')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:mt-2 sm:gap-3">
            <Button
              size="lg"
              className="glow-gold min-h-12 text-base font-black"
              onClick={() => { sfx.click(); setGameSettings({ mode: 'ai' }); setView('play'); }}
            >
              <Play className="h-5 w-5" /> {t('hub_cta')}
            </Button>
            {!user && (
              <Button variant="outline" size="sm" className="min-h-9 bg-background/50 backdrop-blur-md" onClick={() => { sfx.click(); setView('profile'); }}>
                <Sparkles className="h-4 w-4" /> {t('welcome_gift')}
              </Button>
            )}
          </div>
        </div>
      </motion.section>

      {/* ---------- games park ---------- */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-black"><Trophy className="h-5 w-5 text-amber-400" /> {t('hub_games')}</h2>

        {/* featured: Duel of Ideas */}
        <motion.button
          {...riseIn}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="royal-card card-shine group relative block w-full overflow-hidden rounded-3xl text-start transition-transform hover:scale-[1.01]"
          onClick={() => { sfx.click(); setView('play'); }}
        >
          <div className="relative h-28 w-full sm:h-40" aria-hidden>
            <CoverImage
              src="/art/duel-cover.jpg"
              sizes="(max-width: 896px) 100vw, 896px"
              imgClass="object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <span className="absolute end-3 top-3 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-black text-black">LIVE</span>
            <span className="absolute start-3 top-3 rounded-full border border-amber-300/40 bg-black/45 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
              {t('game_duel_tag')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4 sm:p-5">
            <div className="min-w-40 flex-1">
              <div className="text-lg font-black gold-text sm:text-xl">{t('appName')}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">{t('duel_desc')}</div>
            </div>
            <span className="glow-gold pressable inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-black text-primary-foreground transition-transform group-hover:scale-105">
              <Play className="h-4 w-4" /> {t('play')}
            </span>
          </div>
        </motion.button>

        {/* science arcade strip: horizontal scroll on mobile, 3-up grid on desktop */}
        <div className="mb-2 mt-4 flex items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black"><Rocket className="h-4 w-4 text-fuchsia-400" /> {t('arcade_title')}</h3>
          <span className="truncate text-[11px] text-muted-foreground">{t('arcade_sub')}</span>
        </div>
        <div className="nice-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">
          {arcadeGames.map((g, i) => (
            <motion.button
              key={g.id}
              {...riseIn}
              transition={{ duration: 0.4, delay: 0.06 * i, ease: 'easeOut' }}
              className="royal-card card-shine group w-40 flex-none shrink-0 overflow-hidden rounded-2xl text-start transition-transform hover:-translate-y-1 sm:w-auto"
              onClick={() => { sfx.click(); useApp.getState().setView('arcade'); }}
            >
              <div className="relative h-20 w-full" aria-hidden>
                <CoverImage
                  src={g.cover}
                  sizes="(max-width: 640px) 160px, 280px"
                  imgClass="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                <span className="absolute bottom-1.5 end-1.5 grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-black/40 text-amber-300 backdrop-blur-sm">
                  {g.icon}
                </span>
              </div>
              <div className="p-2.5">
                <div className="truncate text-xs font-black">{g.name}</div>
                <span className="mt-1.5 inline-block max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
                  {g.tag}
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </section>

      {/* ---------- research strip ---------- */}
      <motion.section {...riseIn} transition={{ duration: 0.45, ease: 'easeOut' }} className="royal-card mt-6 rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black">{t('about_science')}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{t('hub_research')}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              <span className="rounded-full bg-muted px-2 py-1">Martinez et al. 2023</span>
              <span className="rounded-full bg-muted px-2 py-1">Trends Neurosci. Educ. 2021</span>
              <span className="rounded-full bg-muted px-2 py-1">SDT — Deci &amp; Ryan</span>
              <span className="rounded-full bg-muted px-2 py-1">Flow — Csikszentmihalyi</span>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* daily quests */}
        <section className="royal-card rounded-2xl p-4">
          <h3 className="mb-3 flex items-center gap-2 font-black"><ScrollText className="h-5 w-5 text-emerald-400" /> {t('daily_quests')}</h3>
          {!user && <p className="text-xs text-muted-foreground">{t('auth_no')} <b>{t('login')}</b></p>}
          {user && (
            <div className="space-y-3">
              {quests.map((q) => {
                const done = q.progress >= q.goal;
                return (
                  <div key={q.questId} className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black ${done && !q.claimed ? 'bg-emerald-500/25 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                      {q.claimed ? '✓' : `${localizeDigits(Math.min(q.progress, q.goal), locale)}/${localizeDigits(q.goal, locale)}`}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-xs">
                        <span className="truncate font-bold">{t(`quest_${q.questId}` as 'quest_q_play3')}</span>
                        <span className="text-amber-400">+{localizeDigits(q.reward, locale)} 🪙</span>
                      </div>
                      <Progress value={(Math.min(q.progress, q.goal) / q.goal) * 100} className="mt-1 h-1.5" />
                    </div>
                    <Button size="sm" variant={done && !q.claimed ? 'default' : 'outline'} disabled={!done || q.claimed} onClick={() => claim(q)}>
                      {q.claimed ? t('claimed') : t('claim')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* announcements */}
        <section className="royal-card rounded-2xl p-4">
          <h3 className="mb-3 flex items-center gap-2 font-black"><Megaphone className="h-5 w-5 text-fuchsia-400" /> {t('hub_news')}</h3>
          <div className="nice-scroll max-h-56 space-y-3 overflow-y-auto pe-1">
            {anns.length === 0 && <p className="text-xs text-muted-foreground">…</p>}
            {anns.map((a) => (
              <div key={a.id} className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
                <div className="text-sm font-bold">{pick(a)}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{pickBody(a)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* daily check-in streak calendar */}
      <section className="royal-card mt-4 rounded-2xl p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-black"><CalendarCheck className="h-5 w-5 text-sky-400" /> {t('checkin_title')}</h3>
          {checkin?.auth && checkin.streak != null && checkin.streak > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-black text-amber-400">
              🔥 {t('streak')} {localizeDigits(checkin.streak, locale)}
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('checkin_desc')}</p>

        {!checkin?.auth ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
            <span className="text-xs text-muted-foreground">🔒 {t('guest_locked_checkin')}</span>
            <Button size="sm" variant="outline" onClick={() => { sfx.click(); setView('profile'); }}>{t('login')}</Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {(checkin.rewards ?? [40, 60, 80, 100, 140, 180, 300]).map((rw, i) => {
                const day = i + 1;
                const streakNow = checkin.streak ?? 0;
                const cycleDone = streakNow === 0 ? 0 : ((streakNow - 1) % 7) + 1; // slot of the last claim within the 7-day cycle
                const claimedBefore = day <= cycleDone;
                const isNext = !checkin.claimedToday && day === checkin.nextDay;
                const isJackpot = day === 7;
                return (
                  <div
                    key={day}
                    className={`relative flex flex-col items-center gap-0.5 rounded-xl border p-1.5 text-center transition-all sm:p-2 ${
                      isNext
                        ? 'scale-[1.04] border-amber-400/60 bg-amber-400/10 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
                        : claimedBefore
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : 'border-border bg-muted/40 opacity-70'
                    }`}
                    aria-label={`${t('checkin_day')} ${day}`}
                  >
                    {isJackpot && <span className="absolute -top-2 text-[11px]" aria-hidden>👑</span>}
                    <span className={`text-[9px] font-bold leading-none ${isJackpot ? 'text-amber-400' : 'text-muted-foreground'}`}>
                      {claimedBefore ? '✓' : localizeDigits(day, locale)}
                    </span>
                    <CoinsIcon className={`h-3 w-3 ${isJackpot ? 'text-amber-400' : claimedBefore ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                    <span className={`text-[9px] font-black leading-none sm:text-[11px] ${isNext ? 'text-amber-400' : claimedBefore ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                      {localizeDigits(rw, locale)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-center">
              {checkin.claimedToday ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-400">✓ {t('checkin_done')}</div>
              ) : (
                <Button onClick={claimCheckin} className="glow-gold font-black">
                  <Sparkles className="h-4 w-4" /> {t('checkin_claim')} (+{localizeDigits(checkin.nextReward ?? 0, locale)} 🪙)
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
