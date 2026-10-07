'use client';

/**
 * LeaderboardView — top strategists of the park: 🥇🥈🥉 podium, tier badges
 * (diamond → bronze) and a sortable table (rating / wins / level). The
 * current user's row is highlighted with an amber glow.
 * Round 4: Weekly Race card — Saturday-anchored points race with a live
 * countdown, prize preview and last-week prize claiming.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits, type TKey, type Locale } from '@/lib/i18n';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Gift, Trophy, Users, Swords } from 'lucide-react';

/* ================= types & helpers ================= */

type SortKey = 'rating' | 'wins' | 'level';

interface LbPlayer {
  id: string;
  username: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  bestStreak: number;
  avatarItem: string;
  titleItem: string | null;
  pieceSkin: string;
  isGuest: boolean;
  rank: number;
  isFriend: boolean;
  online: boolean;
  dueling: boolean;
}

interface TierInfo {
  key: TKey;
  cls: string;
}

interface RacePlayer {
  userId: string;
  username: string;
  avatarItem: string;
  titleItem: string | null;
  isGuest: boolean;
  points: number;
  wins: number;
}

interface WeeklyDTO {
  weekKey: string;
  weekEnd: string;
  serverNow: string;
  prizes: number[];
  top: RacePlayer[];
  my: { points: number; wins: number; rank: number | null } | null;
  lastWeek: {
    weekKey: string;
    top: RacePlayer[];
    myClaim: { rank: number; reward: number } | null;
    claimed: boolean;
  };
}

/** rank → tier badge (1-3 diamond, 4-10 platinum, 11-25 gold, 26-40 silver, else bronze) */
function tierFor(rank: number): TierInfo {
  if (rank <= 3) return { key: 'tier_diamond', cls: 'border-amber-400/50 bg-amber-400/15 text-amber-300' };
  if (rank <= 10) return { key: 'tier_platinum', cls: 'border-slate-300/40 bg-slate-400/10 text-slate-200' };
  if (rank <= 25) return { key: 'tier_gold', cls: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400' };
  if (rank <= 40) return { key: 'tier_silver', cls: 'border-zinc-300/30 bg-zinc-400/10 text-zinc-300' };
  return { key: 'tier_bronze', cls: 'border-orange-700/50 bg-orange-700/15 text-orange-400' };
}

/** 'title_mathematician' → 'Mathematician' */
function prettyName(code: string): string {
  const s = code.split('_').slice(1).join(' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

function winRate(p: LbPlayer): number {
  return p.gamesPlayed > 0 ? Math.round((p.wins / p.gamesPlayed) * 100) : 0;
}

function medalFor(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
}

/** live countdown to an ISO instant, refreshed every 30s (day/hour/min granularity, localized) */
function useCountdown(iso: string | null, serverNow: string | null, locale: Locale, labels: { d: string; h: string; m: string }): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!iso) return;
    const skew = serverNow ? Date.now() - new Date(serverNow).getTime() : 0;
    const target = new Date(iso).getTime();
    const tick = () => {
      const left = Math.max(0, target - (Date.now() - skew));
      const d = Math.floor(left / 86_400_000);
      const h = Math.floor((left % 86_400_000) / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const raw = d > 0 ? `${d} ${labels.d}${labels.d.length === 1 ? '' : ' '} ${h} ${labels.h}` : h > 0 ? `${h} ${labels.h} ${m} ${labels.m}` : `${m} ${labels.m}`;
      setLabel(localizeDigits(raw.replace(/\s+/g, ' ').trim(), locale));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [iso, serverNow, locale, labels.d, labels.h, labels.m]);
  return label;
}

/* ================= view ================= */

export function LeaderboardView() {
  const { user, t, locale } = useApp();
  const setView = useApp((s) => s.setView);
  const setPendingChallenge = useApp((s) => s.setPendingChallenge);

  /** inline friend-duel from the leaderboard — hands off to the park lobby */
  const startChallenge = useCallback((p: { id: string; username: string }) => {
    setPendingChallenge({ userId: p.id, name: p.username });
    setView('play');
    sfx.click();
    toast.info(`${t('challenge_goto')} — ${p.username}`);
  }, [setPendingChallenge, setView, t]);

  /** can this row be challenged right now? */
  const challengeable = (p: LbPlayer) => !!user && !p.isGuest && p.isFriend && p.online && !p.dueling;

  const [sort, setSort] = useState<SortKey>('rating');
  const [tick, setTick] = useState(0);
  const [players, setPlayers] = useState<LbPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [weekly, setWeekly] = useState<WeeklyDTO | null>(null);
  const [claiming, setClaiming] = useState(false);

  /* weekly race fetch (independent of sort tabs) */
  useEffect(() => {
    let live = true;
    api
      .get<WeeklyDTO>('/api/leaderboard/weekly')
      .then((d) => live && setWeekly(d))
      .catch(() => live && setWeekly(null));
    return () => {
      live = false;
    };
  }, []);

  const countdown = useCountdown(
    weekly?.weekEnd ?? null,
    weekly?.serverNow ?? null,
    locale,
    { d: t('cnt_d'), h: t('cnt_h'), m: t('cnt_m') },
  );

  /* retry: event-handler driven (bumps tick → effect refetches) */
  const reload = useCallback(() => {
    setLoading(true);
    setFailed(false);
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .get<{ total: number; players: LbPlayer[] }>(`/api/leaderboard?sort=${sort}`)
      .then((d) => {
        if (live) {
          setPlayers(d.players);
          setTotal(d.total);
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true);
          toast.error(t('error'));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [sort, tick, t]);

  const isMe = (p: LbPlayer) => !!user && p.username.toLowerCase() === user.username.toLowerCase();
  const myRow = players.find((p) => isMe(p)) ?? null;
  const podium = [players[1], players[0], players[2]].filter(Boolean) as LbPlayer[];

  const claimPrize = async () => {
    setClaiming(true);
    try {
      const res = await api.post<{ ok: boolean; reward: number; coins: number }>('/api/leaderboard/weekly', {});
      toast.success(`🏆 +${localizeDigits(res.reward, locale)} 🪙`);
      sfx.coin();
      setWeekly((w) => (w ? { ...w, lastWeek: { ...w.lastWeek, claimed: true } } : w));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'CLAIMED') toast(t('week_claimed'));
      else if (msg === 'NOT_ELIGIBLE') toast.error(t('error'));
      else toast.error(t('error'));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10">
      {/* ---------- header ---------- */}
      <section className="royal-card relative mt-4 overflow-hidden rounded-3xl p-5 text-center sm:p-6">
        <div className="pointer-events-none absolute inset-0 shimmer" aria-hidden />
        <h1 className="text-2xl font-black sm:text-3xl">
          🏆 <span className="gold-text">{t('lb_title')}</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t('lb_top')}</p>
        {total > 0 && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {localizeDigits(total, locale)}
          </p>
        )}
      </section>

      {/* ---------- weekly race ---------- */}
      <section className="royal-card relative mt-4 overflow-hidden rounded-3xl border border-amber-500/30 p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0 shimmer opacity-60" aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black sm:text-lg">
            <span className="text-xl" aria-hidden>🏁</span>
            <span className="gold-text">{t('week_race')}</span>
          </h2>
          {countdown && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-black text-emerald-300">
              ⏳ {t('week_ends_in')} {countdown}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('week_sub')}</p>
        <p className="mt-0.5 text-[10px] font-bold text-amber-400/80">{t('week_points_rule')}</p>

        {/* prizes */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black text-muted-foreground"><Gift className="me-1 inline h-3.5 w-3.5" />{t('week_prizes')}:</span>
          {(weekly?.prizes ?? [500, 300, 150]).map((p, i) => (
            <span key={i} className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-black text-amber-300">
              {medalFor(i + 1)} {localizeDigits(p, locale)} 🪙
            </span>
          ))}
        </div>

        {/* current top-3 */}
        {weekly === null ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : weekly.top.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-amber-500/30 px-3 py-4 text-center text-xs text-muted-foreground">
            {user ? t('week_not_in') : t('week_sub')}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {weekly.top.slice(0, 3).map((r, i) => (
              <div
                key={r.userId}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-transform hover:scale-[1.03]',
                  i === 0 ? 'border-amber-400/50 bg-amber-400/10 glow-gold' : 'border-amber-500/20 bg-muted/40',
                )}
              >
                <span className="text-base" aria-hidden>{medalFor(i + 1)}</span>
                <AvatarBubble code={r.avatarItem} size={i === 0 ? 34 : 28} glow={i === 0} />
                <span className="max-w-full truncate text-[10px] font-black sm:text-xs">{r.username}</span>
                <span className="rounded-full bg-amber-500/20 px-2 text-[10px] font-black text-amber-300">
                  {localizeDigits(r.points, locale)} {t('week_points')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* my standing */}
        {weekly?.my && weekly.my.rank !== null && (
          <p className="mt-3 text-center text-[11px] font-bold text-muted-foreground">
            📍 {t('lb_you')}:{' '}
            <b className="text-amber-400">#{localizeDigits(weekly.my.rank, locale)}</b>
            {' '}· {localizeDigits(weekly.my.points, locale)} {t('week_points')}
          </p>
        )}

        {/* last week winners + claim */}
        {weekly && weekly.lastWeek.top.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
              <span className="font-black text-emerald-300">🏆 {t('week_last')}:</span>
              {weekly.lastWeek.top.map((r, i) => (
                <span key={r.userId} className="inline-flex items-center gap-1 font-bold">
                  <span aria-hidden>{medalFor(i + 1)}</span> {r.username}
                  <span className="text-emerald-400/80">({localizeDigits(r.points, locale)})</span>
                </span>
              ))}
            </div>
            {user && weekly.lastWeek.myClaim && (
              weekly.lastWeek.claimed ? (
                <Badge variant="outline" className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-[10px] font-black text-emerald-300">
                  ✓ {t('week_claimed')}
                </Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={claiming}
                  onClick={claimPrize}
                  className="card-shine shrink-0 bg-amber-500 font-black text-amber-950 hover:bg-amber-400"
                >
                  <Gift className="me-1 h-3.5 w-3.5" />
                  {claiming ? t('loading') : `${t('week_claim')} +${localizeDigits(weekly.lastWeek.myClaim.reward, locale)} 🪙`}
                </Button>
              )
            )}
          </div>
        )}
      </section>

      {/* ---------- sort tabs ---------- */}
      <Tabs
        value={sort}
        onValueChange={(v) => {
          sfx.click();
          setSort(v as SortKey);
          setLoading(true);
        }}
        className="mt-4"
      >
        <TabsList className="w-full bg-muted/60 p-1 sm:w-fit">
          {(['rating', 'wins', 'level'] as SortKey[]).map((k) => (
            <TabsTrigger key={k} value={k} className="px-4 text-xs font-bold sm:px-6">
              {t(`sort_${k}` as TKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {failed ? (
        <div className="royal-card mt-4 rounded-2xl p-10 text-center">
          <p className="text-sm text-muted-foreground">{t('error')}</p>
          <Button variant="outline" size="sm" className="mt-3" aria-label={t('loading')} onClick={reload}>
            ⟳ {t('confirm')}
          </Button>
        </div>
      ) : (
        <>
          {/* ---------- podium ---------- */}
          {loading ? (
            <div className="mt-4 flex items-end justify-center gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="royal-card flex w-28 flex-col items-center gap-2 rounded-2xl p-3 sm:w-40">
                  <Skeleton className="h-6 w-6" />
                  <Skeleton className="h-12 w-12 rounded-md" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          ) : (
            podium.length > 0 && (
              <div className="mt-4 flex items-end justify-center gap-2 sm:gap-3">
                {podium.map((p) => {
                  const tier = tierFor(p.rank);
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'royal-card relative flex w-28 flex-col items-center gap-1 rounded-2xl p-3 text-center transition-all hover:scale-[1.03] sm:w-40',
                        p.rank === 1 && 'glow-gold sm:-translate-y-2',
                      )}
                    >
                      <span className="text-2xl" aria-hidden>
                        {medalFor(p.rank)}
                      </span>
                      <AvatarBubble code={p.avatarItem} size={p.rank === 1 ? 52 : 44} glow={p.rank === 1} />
                      <div className="flex max-w-full items-center gap-1">
                        <span className="truncate text-xs font-black sm:text-sm">{p.username}</span>
                        {p.isFriend && <span title={t('lb_friend')} aria-label={t('lb_friend')}>🤝</span>}
                      </div>
                      {p.titleItem && (
                        <div className="max-w-full truncate text-[9px] font-bold text-amber-400">👑 {prettyName(p.titleItem)}</div>
                      )}
                      <div className="text-sm font-black gold-text">{localizeDigits(p.rating, locale)}</div>
                      <Badge variant="outline" className={cn('px-1.5 py-0 text-[9px] font-black', tier.cls)}>
                        {t(tier.key)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ---------- table ---------- */}
          <div className="royal-card mt-4 rounded-2xl p-2 sm:p-3">
            <div className="nice-scroll max-h-[60dvh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16 text-start text-xs">{t('rank')}</TableHead>
                    <TableHead className="text-start text-xs">{t('player')}</TableHead>
                    <TableHead className="text-start text-xs">{t('level')}</TableHead>
                    <TableHead className="text-start text-xs">{t('rating')}</TableHead>
                    <TableHead className="text-start text-xs">{t('wins')}</TableHead>
                    <TableHead className="text-start text-xs">{t('win_rate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`sk-${i}`}>
                          <TableCell colSpan={6}>
                            <Skeleton className="h-8 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    : players.map((p, rowIdx) => {
                        const tier = tierFor(p.rank);
                        const mine = isMe(p);
                        return (
                          <TableRow
                            key={p.id}
                            className={cn('row-enter border-amber-500/10', mine && 'bg-amber-400/10 font-bold shadow-[inset_0_0_0_1px_rgba(251,191,36,.35)]')}
                            style={{ '--row-delay': `${Math.min(rowIdx * 28, 560)}ms` } as React.CSSProperties}
                          >
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <span className="w-6 text-xs font-black">{localizeDigits(p.rank, locale)}</span>
                                <Badge variant="outline" className={cn('px-1.5 py-0 text-[9px] font-black', tier.cls)}>
                                  {t(tier.key)}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <AvatarBubble code={p.avatarItem} size={30} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className="max-w-28 truncate text-xs font-black sm:max-w-44 sm:text-sm">{p.username}</span>
                                    {p.isGuest && <span className="text-[9px] text-muted-foreground">({t('guest')})</span>}
                                    {p.isFriend && <span title={t('lb_friend')} aria-label={t('lb_friend')}>🤝</span>}
                                    {mine && (
                                      <span className="rounded-full bg-amber-400/20 px-1.5 text-[9px] font-black text-amber-300">{t('you')}</span>
                                    )}
                                    {challengeable(p) && (
                                      <button
                                        type="button"
                                        onClick={() => startChallenge(p)}
                                        title={`${t('challenge')} — ${p.username}`}
                                        aria-label={`${t('challenge')} ${p.username}`}
                                        className="ms-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-300 transition-all hover:scale-110 hover:border-amber-400 hover:bg-amber-400/20 hover:text-amber-200 focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:outline-none"
                                      >
                                        <Swords className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    {p.dueling && (
                                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[8px] font-black text-amber-400" title={t('fr_dueling')}>
                                        🎮 {t('fr_dueling')}
                                      </span>
                                    )}
                                  </div>
                                  {p.titleItem && (
                                    <div className="max-w-32 truncate text-[9px] font-bold text-amber-400">👑 {prettyName(p.titleItem)}</div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{localizeDigits(p.level, locale)}</TableCell>
                            <TableCell className="text-xs font-black text-amber-400">{localizeDigits(p.rating, locale)}</TableCell>
                            <TableCell className="text-xs text-emerald-400">{localizeDigits(p.wins, locale)}</TableCell>
                            <TableCell className="text-xs">{localizeDigits(winRate(p), locale)}%</TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ---------- your rank ---------- */}
          {user && myRow && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              📍 {t('lb_you')}:{' '}
              <b className="text-amber-400">
                #{localizeDigits(myRow.rank, locale)}
              </b>{' '}
              · {t('rating')} {localizeDigits(myRow.rating, locale)} · {t('wins')} {localizeDigits(myRow.wins, locale)}
            </p>
          )}
          {!loading && players.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">—</p>}
        </>
      )}
    </div>
  );
}
