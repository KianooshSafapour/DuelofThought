'use client';

/**
 * ProfileView — identity card (avatar, title, XP/level, rating, coins),
 * stats grid, bio editor, showcase picker (max 3 achievements), achievements
 * grid with progress, match history and settings (sound/language) + a
 * collapsible player-report form.
 */
import { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip } from 'recharts';
import { useApp } from '@/store/app';
import { api, type SafeUserDTO } from '@/lib/api';
import { localizeDigits, type Locale, type TKey } from '@/lib/i18n';
import { LOCALES, LOCALE_META, levelFromXpT } from '@/components/shared/shell-helpers';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { RARITY_META, ACHIEVEMENTS, type Rarity } from '@/lib/game/content';
import { setSoundEnabled, sfx, isMusicEnabled, setMusicEnabled, setMusicMood, getMusicMood, type MusicMood } from '@/lib/sound';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  Flag,
  Gamepad2,
  Gem,
  Globe,
  Grid2x2,
  Layers,
  LogIn,
  Medal,
  MessageSquareText,
  Music2,
  Moon,
  Sun,
  Drum,
  Music4,
  Percent,
  Rocket,
  Save,
  Scale,
  ScrollText,
  Settings2,
  ShoppingBag,
  Skull,
  Smartphone,
  Sparkles,
  Star,
  Swords,
  TrendingUp,
  Trophy,
  Volume2,
  Wifi,
  XCircle,
  Zap,
  Crown,
  Flame,
  ChevronDown,
  Film,
  type LucideIcon,
} from 'lucide-react';
import { ReplayModal } from '@/components/game/ReplayModal';

/* ================= types & helpers ================= */

interface AchDTO {
  id: string;
  icon: string;
  rarity: Rarity;
  goal: number;
  coins: number;
  progress: number;
  unlockedAt: string | null;
}

interface GameRow {
  id: string;
  mode: string;
  endReason: string;
  moves: number;
  p1Name: string;
  p2Name: string;
  youWon: boolean;
  draw: boolean;
  p1RatingDelta: number;
  p2RatingDelta: number;
  createdAt: string;
}

/** lucide icon lookup for achievement defs (Meteor missing in this build → Sparkles) */
const ACH_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Grid2x2,
  TrendingUp,
  Gamepad2,
  Globe,
  ScrollText,
  Scale,
  Flame,
  Skull,
  Trophy,
  ShoppingBag,
  Wifi,
  Layers,
  Rocket,
  Zap,
  Star,
  Crown,
  Gem,
  Meteor: Sparkles,
};

const REASONS = ['INSULT', 'CHEAT', 'SPAM', 'NAME', 'OTHER'] as const;

/** 'first_blood' → 'First blood' (fallback for titles) */
function prettyName(code: string): string {
  const s = code.split('_').slice(1).join(' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

/** Localized achievement label built from its metric + goal (readable in all 4 locales). */
function achLabel(a: { id: string; metric: string; goal: number }, t: (k: TKey) => string): string {
  const g = a.goal;
  switch (a.metric) {
    case 'wins': return `${g} × ${t('wins')}`;
    case 'kindWins': return `${g > 1 ? `${g} × ` : ''}${t('quest_q_kind')}`;
    case 'runWins': return `${g > 1 ? `${g} × ` : ''}${t('quest_q_run')}`;
    case 'games': return `${g} × ${t('games_played')}`;
    case 'onlineWins': return `${g} × ${t('online')}`;
    case 'onlineGames': return `${g} × ${t('online')}`;
    case 'hardWins': return `${g} × AI ${t('ai_hard')}`;
    case 'streakBest': return `${g} × ${t('streak')}`;
    case 'itemsOwned': return `${g} × 🛍`;
    case 'level': return `${t('level')} ${g}`;
    case 'questsDone': return `${g} × ${t('daily_quests')}`;
    case 'draws': return `${g} × ${t('draws_stat')}`;
    default: return prettyName(a.id);
  }
}

/** Resolve an achievement id to its catalog def → localized label. */
function achLabelById(id: string, t: (k: TKey) => string): string {
  const def = ACHIEVEMENTS.find((x) => x.id === id);
  return def ? achLabel(def, t) : prettyName(id);
}

function fmtDate(iso: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function timeAgo(iso: string, locale: Locale): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return rtf.format(-Math.max(s, 1), 'second');
    const m = Math.round(s / 60);
    if (m < 60) return rtf.format(-m, 'minute');
    const h = Math.round(m / 60);
    if (h < 24) return rtf.format(-h, 'hour');
    return rtf.format(-Math.round(h / 24), 'day');
  } catch {
    return '';
  }
}

function AchIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ACH_ICONS[name] ?? Sparkles;
  return <Icon className={className} />;
}

/* ================= view ================= */

export function ProfileView() {
  const { user, t, locale, patchUser, setLocale } = useApp();
  const uid = user?.id;

  const [achs, setAchs] = useState<AchDTO[] | null>(null);
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [bio, setBio] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [showcase, setShowcase] = useState<string[]>([]);
  const [repOpen, setRepOpen] = useState(false);
  const [repTarget, setRepTarget] = useState('');
  const [repReason, setRepReason] = useState<(typeof REASONS)[number]>('INSULT');
  const [repDetails, setRepDetails] = useState('');
  const [repBusy, setRepBusy] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);
  /* SMS recovery phone (T9-a) */
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  /* ---------- data ---------- */
  useEffect(() => {
    if (!uid) {
      setAchs(null);
      setGames(null);
      return;
    }
    let live = true;
    api
      .get<{ achievements: AchDTO[] }>('/api/achievements')
      .then((d) => live && setAchs(d.achievements))
      .catch(() => live && setAchs([]));
    api
      .get<{ games: GameRow[] }>('/api/game/history')
      .then((d) => live && setGames(d.games))
      .catch(() => live && setGames([]));
    return () => {
      live = false;
    };
  }, [uid]);

  useEffect(() => {
    if (user) {
      setBio(user.bio ?? '');
      setShowcase(user.showcase ?? []);
      setPhoneDraft(((user as SafeUserDTO & { phone?: string | null }).phone) ?? '');
    }
  }, [uid]);

  /* ---------- guards ---------- */
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4">
        <section className="royal-card mt-8 rounded-3xl p-10 text-center">
          <div className="text-5xl" aria-hidden>
            👤
          </div>
          <h1 className="mt-3 text-xl font-black gold-text">{t('profile_title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth_no')}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-400/10 px-4 py-1.5 text-sm font-black text-amber-400">
            <LogIn className="h-4 w-4" /> {t('login')} →
          </p>
        </section>
      </div>
    );
  }

  const lvl = levelFromXpT(user.xp);
  const winRate = user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;
  const unlocked = (achs ?? []).filter((a) => !!a.unlockedAt);
  const savedPhone = (user as SafeUserDTO & { phone?: string | null }).phone ?? null;

  /* ---------- actions ---------- */
  const saveBio = async () => {
    setBioBusy(true);
    try {
      const res = await api.patch<{ ok: boolean; user: SafeUserDTO }>('/api/profile', { bio: bio.trim() });
      patchUser(res.user);
      sfx.click();
      toast.success(t('success'));
    } catch (e) {
      if ((e as Error).message === 'BAD_BIO') toast.error(t('bio_bad'));
      else toast.error(t('error'));
    } finally {
      setBioBusy(false);
    }
  };

  const toggleShowcase = async (id: string, checked: boolean) => {
    const prev = showcase;
    const next = checked ? [...prev, id] : prev.filter((x) => x !== id);
    if (next.length > 3) {
      toast(t('showcase_hint'));
      return;
    }
    setShowcase(next);
    try {
      const res = await api.patch<{ ok: boolean; user: SafeUserDTO }>('/api/profile', { showcase: next });
      patchUser(res.user);
      sfx.click();
    } catch {
      setShowcase(prev);
      toast.error(t('error'));
    }
  };

  /* ---------- SMS recovery phone (T9-a) ---------- */
  const savePhone = async () => {
    setPhoneBusy(true);
    try {
      const res = await api.patch<{ ok: boolean; user: SafeUserDTO }>('/api/profile', { phone: phoneDraft.trim() });
      patchUser(res.user);
      setPhoneDraft(((res.user as SafeUserDTO & { phone?: string | null }).phone) ?? '');
      sfx.click();
      toast.success(t('success'));
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'PHONE_TAKEN') toast.error(t('e_sms_phone_taken'));
      else if (code === 'PHONE_BAD') toast.error(t('e_sms_phone_bad'));
      else toast.error(t('error'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const clearPhone = async () => {
    setPhoneBusy(true);
    try {
      const res = await api.patch<{ ok: boolean; user: SafeUserDTO }>('/api/profile', { phone: null });
      patchUser(res.user);
      setPhoneDraft('');
      sfx.click();
      toast.success(t('success'));
    } catch {
      toast.error(t('error'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const sendReport = async () => {
    if (!repTarget.trim()) return;
    setRepBusy(true);
    try {
      await api.post('/api/reports', { targetName: repTarget.trim(), reason: repReason, details: repDetails.trim() });
      toast.success(t('report_sent'));
      setRepTarget('');
      setRepDetails('');
      setRepReason('INSULT');
      setRepOpen(false);
    } catch {
      toast.error(t('error'));
    } finally {
      setRepBusy(false);
    }
  };

  /* ---------- derived labels ---------- */
  const endLabel = (e: string): string =>
    e === 'KIND' ? t('win_kind') : e === 'RUN' ? t('win_run') : e === 'FULL' ? t('draw_full') : e === 'RESIGN' ? t('resign') : e === 'TIMEOUT' ? t('timeout_win') : '';

  const modeBadge = (m: string): { label: string; cls: string } =>
    m === 'PVE'
      ? { label: t('mode_ai'), cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' }
      : m === 'ONLINE'
        ? { label: t('online'), cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' }
        : { label: t('mode_local'), cls: 'border-violet-500/40 bg-violet-500/10 text-violet-300' };

  const opponentOf = (g: GameRow): string => {
    const mine = user.username.toLowerCase();
    return g.p1Name && g.p1Name.toLowerCase() === mine ? g.p2Name || '—' : g.p1Name || '—';
  };

  /* rating history reconstructed from ELO deltas, anchored at the true current rating
     (plain derivation — ProfileView has an early guest return, so no hooks below it) */
  const ratingSeries = (() => {
    if (!games || !user) return [] as number[];
    const myDelta = (g: GameRow) =>
      g.p1Name && g.p1Name.toLowerCase() === user.username.toLowerCase() ? g.p1RatingDelta : g.p2RatingDelta;
    const asc = [...games].reverse();
    const total = asc.reduce((a, g) => a + myDelta(g), 0);
    let acc = user.rating - total;
    const out = [acc];
    for (const g of asc) { acc += myDelta(g); out.push(acc); }
    return out;
  })();
  const ratingData = ratingSeries.map((v, i) => ({ i, v }));
  const rMin = ratingSeries.length ? Math.min(...ratingSeries) : 0;
  const rMax = ratingSeries.length ? Math.max(...ratingSeries) : 0;

  const stats: { icon: LucideIcon; label: string; value: string; cls: string }[] = [
    { icon: Trophy, label: t('wins'), value: localizeDigits(user.wins, locale), cls: 'text-emerald-400 bg-emerald-500/10' },
    { icon: XCircle, label: t('losses'), value: localizeDigits(user.losses, locale), cls: 'text-rose-400 bg-rose-500/10' },
    { icon: Scale, label: t('draws_stat'), value: localizeDigits(user.draws, locale), cls: 'text-sky-400 bg-sky-500/10' },
    { icon: Gamepad2, label: t('games_played'), value: localizeDigits(user.gamesPlayed, locale), cls: 'text-fuchsia-400 bg-fuchsia-500/10' },
    { icon: Flame, label: t('best_streak'), value: localizeDigits(user.bestStreak, locale), cls: 'text-amber-400 bg-amber-500/10' },
    { icon: Percent, label: t('win_rate'), value: `${localizeDigits(winRate, locale)}%`, cls: 'text-violet-300 bg-violet-500/10' },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 pb-10 pt-4">
      {/* ---------- header card ---------- */}
      <section className="royal-card relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 shimmer" aria-hidden />
        <div className="flex flex-wrap items-center gap-4">
          <AvatarBubble code={user.avatarItem} size={72} glow />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black sm:text-2xl">{user.username}</h1>
              {user.titleItem && (
                <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] font-black text-amber-300">
                  👑 {prettyName(user.titleItem)}
                </Badge>
              )}
              {user.isGuest && (
                <Badge variant="outline" className="text-[10px] font-black text-muted-foreground">
                  {t('guest')}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-black text-emerald-400">
                ⭐ {t('level')} {localizeDigits(lvl.level, locale)}
              </span>
              <span className="font-black text-amber-400">
                🪙 {localizeDigits(user.coins, locale)} {t('coins')}
              </span>
              <span className="font-bold">
                🎯 {t('rating')}: {localizeDigits(user.rating, locale)}
              </span>
              <span>
                📅 {t('member_since')} {fmtDate(user.createdAt, locale)}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <Progress value={(lvl.into / lvl.need) * 100} className="h-2 flex-1" aria-label={t('xp')} />
              <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                {localizeDigits(lvl.into, locale)} / {localizeDigits(lvl.need, locale)} {t('xp')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- stats grid ---------- */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-black">
          <Star className="h-4 w-4 text-amber-400" /> {t('stats')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="royal-card flex items-center gap-3 rounded-2xl p-3 transition-all hover:scale-[1.02]">
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', s.cls)}>
                <s.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-lg font-black leading-none">{s.value}</div>
                <div className="mt-1 truncate text-[10px] font-bold text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- rating trend sparkline ---------- */}
      {ratingSeries.length >= 2 && (
        <section className="royal-card rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-black">
              <TrendingUp className="h-4 w-4 text-amber-400" /> {t('rating_trend')}
            </h3>
            <span className="text-xs font-black text-amber-400">
              🎯 {localizeDigits(user.rating, locale)}
              {ratingSeries[ratingSeries.length - 1] >= ratingSeries[0] ? ' ↗' : ' ↘'}
            </span>
          </div>
          <div className="h-20" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratingData} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
                <YAxis domain={[rMin - 6, rMax + 6]} hide />
                <Tooltip
                  cursor={{ stroke: 'rgba(251,191,36,0.35)', strokeWidth: 1 }}
                  contentStyle={{ background: 'rgba(15,10,30,0.92)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 10, fontSize: 11 }}
                  labelFormatter={() => ''}
                  formatter={(v: number | string) => [localizeDigits(Number(v), locale), t('rating')]}
                />
                <Line type="monotone" dataKey="v" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-bold text-muted-foreground" dir="ltr">
            <span>{localizeDigits(rMin, locale)}</span>
            <span>{localizeDigits(rMax, locale)}</span>
          </div>
        </section>
      )}

      {/* ---------- bio + showcase ---------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="royal-card rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-black">
            <MessageSquareText className="h-4 w-4 text-fuchsia-400" /> {t('bio')}
          </h3>
          <Input
            className="mt-3"
            value={bio}
            maxLength={140}
            placeholder={t('bio_hint')}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className={cn('text-[10px] font-bold', bio.length >= 140 ? 'text-rose-400' : 'text-muted-foreground')}>
              {localizeDigits(bio.length, locale)} / {localizeDigits(140, locale)}
            </span>
            <Button
              size="sm"
              className="glow-gold"
              disabled={bioBusy || bio.trim() === (user.bio ?? '')}
              onClick={() => void saveBio()}
            >
              <Save className="h-4 w-4" /> {t('save_bio')}
            </Button>
          </div>
        </section>

        <section className="royal-card rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-black">
            <Medal className="h-4 w-4 text-amber-400" /> {t('showcase')}
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">{t('showcase_hint')}</p>
          {showcase.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {showcase.map((id) => (
                <Badge key={id} variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] font-black text-amber-300">
                  🏆 {achLabelById(id, t)}
                </Badge>
              ))}
            </div>
          )}
          <div className="nice-scroll mt-3 max-h-40 space-y-1 overflow-y-auto pe-1">
            {achs === null ? (
              <Skeleton className="h-16 w-full" />
            ) : unlocked.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">—</p>
            ) : (
              unlocked.map((a) => {
                const checked = showcase.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!checked && showcase.length >= 3}
                      onCheckedChange={(v) => void toggleShowcase(a.id, v === true)}
                    />
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded"
                      style={{ background: `${RARITY_META[a.rarity].color}1a`, color: RARITY_META[a.rarity].color }}
                    >
                      <AchIcon name={a.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate font-bold">{achLabelById(a.id, t)}</span>
                  </label>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ---------- achievements ---------- */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-black">
          <Sparkles className="h-4 w-4 text-fuchsia-400" /> {t('achievements')}
        </h2>
        {achs === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {achs.map((a) => {
              const meta = RARITY_META[a.rarity];
              const Icon = ACH_ICONS[a.icon] ?? Sparkles;
              return (
                <div
                  key={a.id}
                  className={cn(
                    'royal-card flex flex-col rounded-2xl p-3 transition-all hover:scale-[1.02]',
                    !a.unlockedAt && 'opacity-75',
                    a.unlockedAt && 'glow-gold',
                  )}
                  style={{ borderColor: `${meta.color}44` }}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className="grid h-9 w-9 place-items-center rounded-lg"
                      style={{ background: `${meta.color}1f`, color: meta.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    {a.unlockedAt ? (
                      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[9px] font-black text-emerald-300">
                        ✓ {t('unlocked')}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground" title={t('locked')}>
                        🔒
                      </span>
                    )}
                  </div>
                  <div className="mt-2 truncate text-xs font-black">{achLabelById(a.id, t)}</div>
                  <Progress value={(a.progress / a.goal) * 100} className="mt-2 h-1.5" />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-bold">
                      {localizeDigits(Math.min(a.progress, a.goal), locale)} / {localizeDigits(a.goal, locale)}
                    </span>
                    <span className="font-black text-amber-400">+{localizeDigits(a.coins, locale)} 🪙</span>
                  </div>
                  {a.unlockedAt && <div className="mt-1 text-[9px] text-muted-foreground">📅 {fmtDate(a.unlockedAt, locale)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- match history ---------- */}
      <section className="royal-card rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-sm font-black">
          <Swords className="h-4 w-4 text-emerald-400" /> {t('history')}
        </h3>
        <div className="nice-scroll mt-3 max-h-80 space-y-2 overflow-y-auto pe-1">
          {games === null ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)
          ) : games.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('no_history')}</p>
          ) : (
            games.map((g) => {
              const mb = modeBadge(g.mode);
              const result = g.draw
                ? { label: t('draws_stat'), cls: 'border-zinc-400/40 bg-zinc-400/10 text-zinc-300' }
                : g.youWon
                  ? { label: t('wins'), cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' }
                  : { label: t('losses'), cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
              return (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/10 bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className={cn('shrink-0 text-[9px] font-black', mb.cls)}>
                      {mb.label}
                    </Badge>
                    <span className="truncate text-xs font-bold">
                      {t('opponent')}: {opponentOf(g)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{endLabel(g.endReason)}</span>
                    <span>♟ {localizeDigits(g.moves, locale)}</span>
                    <span>⏱ {timeAgo(g.createdAt, locale)}</span>
                    <Badge variant="outline" className={cn('text-[9px] font-black', result.cls)}>
                      {result.label}
                    </Badge>
                    <button
                      onClick={() => { setReplayId(g.id); sfx.click(); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-300 transition-colors hover:bg-amber-500/20"
                      aria-label={t('replay')}
                    >
                      <Film className="h-3 w-3" /> {t('replay')}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ---------- replay viewer (remounts per game) ---------- */}
      {replayId && <ReplayModal gameId={replayId} onOpenChange={(o) => !o && setReplayId(null)} />}

      {/* ---------- settings ---------- */}
      <section className="royal-card rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-sm font-black">
          <Settings2 className="h-4 w-4 text-sky-400" /> {t('settings')}
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="pf-sound"
              checked={user.soundOn}
              onCheckedChange={(v) => {
                patchUser({ soundOn: v });
                setSoundEnabled(v);
                sfx.click();
                api.patch('/api/profile', { soundOn: v }).catch(() => undefined);
              }}
            />
            <Label htmlFor="pf-sound" className="cursor-pointer text-xs font-bold">
              <Volume2 className="me-1 inline h-3.5 w-3.5" />
              {t('sound')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <MusicSwitch />
            <Label htmlFor="pf-music" className="cursor-pointer text-xs font-bold">
              <Music2 className="me-1 inline h-3.5 w-3.5" />
              {t('music')}
            </Label>
          </div>
          <MoodPicker />
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Select
              value={locale}
              onValueChange={(v) => {
                setLocale(v as Locale);
                sfx.click();
              }}
            >
              <SelectTrigger size="sm" className="w-36" aria-label={t('language')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_META[l].flag} {LOCALE_META[l].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* SMS recovery phone (T9-a) */}
        <div className="mt-4 border-t border-amber-500/15 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1 space-y-1">
              <Label htmlFor="pf-phone" className="text-xs font-bold">
                <Smartphone className="me-1 inline h-3.5 w-3.5" />
                {t('sms_phone_label')}
              </Label>
              <Input
                id="pf-phone"
                dir="ltr"
                inputMode="tel"
                placeholder={t('sms_phone_hint')}
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                maxLength={24}
                autoComplete="tel"
                disabled={phoneBusy || user.isGuest}
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {savedPhone ? t('sms_phone_hint_profile') : `${t('sms_phone_none')} ${t('sms_phone_hint_profile')}`}
              </p>
            </div>
            <Button
              size="sm"
              className="glow-gold"
              disabled={phoneBusy || user.isGuest || phoneDraft.trim() === '' || phoneDraft.trim() === (savedPhone ?? '')}
              onClick={() => void savePhone()}
            >
              <Save className="h-4 w-4" /> {t('sms_phone_save')}
            </Button>
            <Button size="sm" variant="outline" disabled={phoneBusy || user.isGuest || !savedPhone} onClick={() => void clearPhone()}>
              {t('sms_phone_clear')}
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- report player ---------- */}
      <section className="royal-card rounded-2xl p-4">
        <Collapsible open={repOpen} onOpenChange={setRepOpen}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-black">
              <Flag className="h-4 w-4 text-rose-400" /> {t('report')}
            </h3>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('report')}>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', repOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input
                dir="ltr"
                className="min-w-40 flex-1"
                placeholder={t('reported_player')}
                value={repTarget}
                maxLength={32}
                onChange={(e) => setRepTarget(e.target.value)}
              />
              <Select value={repReason} onValueChange={(v) => setRepReason(v as (typeof REASONS)[number])}>
                <SelectTrigger size="sm" className="w-44" aria-label={t('reason')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`report_reason_${r}` as TKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              rows={2}
              maxLength={500}
              value={repDetails}
              onChange={(e) => setRepDetails(e.target.value)}
              placeholder={t('reason')}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                disabled={repBusy || !repTarget.trim()}
                onClick={() => void sendReport()}
              >
                <Flag className="h-4 w-4" /> {t('report')}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}

/** Ambient-music toggle (persisted in localStorage; engine lives in lib/sound). */
function MusicSwitch() {
  const [on, setOn] = useState(() => isMusicEnabled());
  return (
    <Switch
      id="pf-music"
      checked={on}
      onCheckedChange={(v) => {
        setMusicEnabled(v);
        setOn(v);
        sfx.click();
      }}
    />
  );
}

/** Music-mood pills (night / desert / battle) — mirrors the header dropdown. */
function MoodPicker() {
  const { t } = useApp();
  const [mood, setMoodState] = useState<MusicMood>(() => getMusicMood());
  const items: { key: MusicMood; label: string; icon: React.ReactNode }[] = [
    { key: 'night', label: t('mood_night'), icon: <Moon className="h-3.5 w-3.5" /> },
    { key: 'desert', label: t('mood_desert'), icon: <Sun className="h-3.5 w-3.5" /> },
    { key: 'battle', label: t('mood_battle'), icon: <Drum className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label={t('music_mood')}>
      <Music4 className="h-4 w-4 text-muted-foreground" />
      <div className="flex gap-1 rounded-full bg-muted p-1">
        {items.map((it) => (
          <button
            key={it.key}
            role="radio"
            aria-checked={mood === it.key}
            title={it.label}
            onClick={() => { setMoodState(it.key); setMusicMood(it.key); sfx.click(); }}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold transition-all ${
              mood === it.key ? 'bg-amber-400/20 text-amber-400 glow-gold' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {it.icon}
            <span className="hidden sm:inline">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
