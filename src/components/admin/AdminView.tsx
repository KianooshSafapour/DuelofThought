'use client';

/**
 * AdminView — "Duel of Ideas" admin dashboard (task 12-b + 6-b).
 * Tabs: Overview (stats + recharts + economy), Users (search/ban/coins/roles),
 * Market & Gifting (admin gifts + developer cheat engine), Chests (odds editor),
 * Reports (moderation queue), Content (word filter + announcements),
 * Store (price/active tuning), Chat logs (flagged messages),
 * Live Ops Monitor (presence + live event feed), Games (feature switches).
 * Persian-first / RTL-aware; bilingual inline labels for admin-only strings.
 */
import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits } from '@/lib/i18n';
import type { TKey, Locale } from '@/lib/i18n';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BoardsTab } from '@/components/admin/BoardsTab';
import { FriendChatAdmin } from '@/components/admin/FriendChatAdmin';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Shield, Users, Activity, Swords, Gamepad2, Flag, Wifi, Ban, Ghost, Coins, Megaphone, Zap,
  Search, MoreVertical, ChevronLeft, ChevronRight, ShieldCheck, ShieldOff, UserCheck,
  Filter, MessageSquare, ShoppingBag, Check, X, Trash2, Plus, Download, Eye,
  Gift, Wand2, TriangleAlert, RefreshCw, PackageOpen, Radio, Orbit, Brain, Star,
} from 'lucide-react';

/* ---------------------------------- types --------------------------------- */

interface StatsDTO {
  cards: {
    totalUsers: number; activeToday: number; totalGames: number; gamesToday: number;
    openReports: number; guests: number; bannedUsers: number; onlineNow: number;
  };
  charts: {
    gamesPerDay: { date: string; count: number }[];
    winTypes: Record<string, number>;
    modeDist: Record<string, number>;
    firstMove: number[];
    avgMoves: number;
  };
  economy: {
    purchases: number; coinsMinted: number; coinsSpent: number;
    topItems: { code: string; category: string; sales: number; price: number }[];
  };
}

interface AdminUser {
  id: string; username: string; role: string; isGuest: boolean;
  banned: boolean; banReason: string | null; bannedUntil: string | null;
  coins: number; level: number; rating: number; gamesPlayed: number;
  createdAt: string; lastSeen: string | null; banCount: number;
}
interface UsersDTO { users: AdminUser[]; total: number; page: number }

interface AdminReport {
  id: string; targetName: string; reason: string; details: string; chatExcerpt: string;
  status: string; createdAt: string;
  reporter?: { username: string } | null;
  target?: { username: string; banned: boolean; banCount: number } | null;
}

interface BannedWordRow { id: string; word: string; severity: number }
interface AnnouncementRow {
  id: string; titleFa: string; titleEn: string; titleAr: string; titleTr: string;
  bodyFa: string; bodyEn: string; bodyAr: string; bodyTr: string;
  kind: string; active: boolean; createdAt: string;
}
interface ItemRow {
  code: string; category: string; rarity: string; price: number;
  active: boolean; purchasedBy: number;
}
interface ChatRow {
  id: string; roomId: string; senderName: string; text: string;
  masked: boolean; flaggedWords: string; createdAt: string;
  sender?: { username: string; banned: boolean } | null;
}

/* task 6-b */
interface StoreItemRow { code: string; category: string; rarity: string; price: number }
interface GiftResp { ok: boolean; count: number }
interface CheatResp {
  ok: boolean; unlocked: number;
  user: { coins: number; xp: number; level: number; rating: number; banned: boolean };
}
interface BoxDropRow { id: string; kind: 'COINS' | 'XP' | 'ITEM'; itemCode: string | null; amount: number; weight: number }
interface AdminBoxRow { code: string; rarity: string; price: number; image: string; opens: number; active: boolean; drops: BoxDropRow[] }
interface BoxesDTO { boxes: AdminBoxRow[] }
interface MonitorEventRow { id: string; type: string; username: string | null; payload: unknown; createdAt: string }
interface MonitorDTO {
  presence: { players: number; live: number };
  onlineNow: number; arcadeToday: number; boxOpensToday: number;
  purchasesToday: number; gameEventsToday: number;
  events: MonitorEventRow[];
}
interface ConfigDTO { flags: Record<string, boolean> }

/* -------------------------------- helpers --------------------------------- */

/** Small data-fetching hook with refresh + loading + error toast.
 *  `loading` is derived from the last *completed* request (url+tick identity),
 *  so no setState is needed synchronously inside the effect. */
function useAdminData<T>(url: string) {
  const t = useApp((s) => s.t);
  const [done, setDone] = useState<{ url: string; tick: number; data: T | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get<T>(url)
      .then((d) => { if (alive) setDone({ url, tick, data: d }); })
      .catch(() => {
        if (alive) {
          setDone({ url, tick, data: null });
          toast.error(t('error'));
        }
      });
    return () => { alive = false; };
  }, [url, tick, t]);

  /* stable identity → safe as an effect/interval dependency (task 6-b auto-refresh) */
  const refresh = useCallback(() => setTick((x) => x + 1), []);

  const current = done !== null && done.url === url && done.tick === tick;
  return {
    data: current ? done.data : null,
    loading: !current,
    refresh,
    /** optimistic in-place patch of the current dataset */
    patch: (fn: (d: T) => T) =>
      setDone((s) => (s !== null && s.url === url && s.data !== null ? { ...s, data: fn(s.data) } : s)),
  };
}

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale);
}

function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale);
}

function apiErrMsg(e: unknown, t: (k: TKey) => string): string {
  const code = (e as Error)?.message ?? '';
  if (code === 'ADMIN_TARGET') return 'این هدف یک مدیر است · Target is an admin';
  if (code === 'SELF') return 'این عمل روی خودتان ممکن نیست · Cannot target yourself';
  if (code === 'RATE') return 'سرعت اقدامات زیاد است · Too many actions, slow down';
  if (code === 'FORBIDDEN') return t('admin_only');
  return t('error');
}

const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function winLabel(k: string, t: (key: TKey) => string): string {
  switch (k) {
    case 'KIND': return t('win_kind').replace(/!/g, '');
    case 'RUN': return t('win_run').replace(/!/g, '');
    case 'FULL': return t('draw_full').split('—')[0]?.trim() ?? 'FULL';
    case 'RESIGN': return t('resign');
    case 'TIMEOUT': return 'وقت تمام · Timeout';
    default: return k;
  }
}

function modeLabel(k: string): string {
  switch (k) {
    case 'PVE': return 'با ربات · vs AI';
    case 'LOCAL_PVP': return 'دو نفره · Local';
    case 'ONLINE': return 'آنلاین · Online';
    default: return k;
  }
}

const TOOLTIP_STYLE = {
  background: 'rgba(24,14,46,.96)',
  border: '1px solid rgba(251,191,36,.3)',
  borderRadius: 12,
  fontSize: 12,
  color: '#f8fafc',
} as const;

const SEV_STYLE: Record<number, string> = {
  1: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
  2: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  3: 'border-rose-400/40 bg-rose-500/10 text-rose-300',
};

const RARITY_STYLE: Record<string, string> = {
  COMMON: 'border-slate-400/40 bg-slate-500/15 text-slate-300',
  RARE: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
  EPIC: 'border-purple-400/40 bg-purple-500/15 text-purple-300',
  LEGENDARY: 'border-amber-400/40 bg-amber-500/15 text-amber-300',
  ULTIMATE: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
  ACTIONED: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
  DISMISSED: 'border-slate-400/40 bg-slate-500/15 text-slate-300',
};

const KIND_STYLE: Record<string, string> = {
  INFO: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
  EVENT: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  WARNING: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
};
const KIND_LABEL: Record<string, string> = {
  INFO: 'اطلاع · Info',
  EVENT: 'رویداد · Event',
  WARNING: 'هشدار · Warning',
};

/* task 6-b event/feed/odds helpers */
const EVENT_STYLE: Record<string, string> = {
  game_pve: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
  game_online: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  game_local: 'border-violet-400/40 bg-violet-500/10 text-violet-300',
  box_buy: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  box_open: 'border-purple-400/40 bg-purple-500/10 text-purple-300',
  box_gift: 'border-pink-400/40 bg-pink-500/10 text-pink-300',
  gift: 'border-pink-400/40 bg-pink-500/10 text-pink-300',
  arcade_orbit: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300',
  arcade_synapse: 'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-300',
  arcade_stellar: 'border-orange-400/40 bg-orange-500/10 text-orange-300',
  purchase: 'border-teal-400/40 bg-teal-500/10 text-teal-300',
  checkin: 'border-lime-400/40 bg-lime-500/10 text-lime-300',
};
const EVENT_FALLBACK_CLS = 'border-slate-400/40 bg-slate-500/10 text-slate-300';

function eventLabel(type: string): string {
  switch (type) {
    case 'game_pve': return 'دوئل با ربات · Duel vs AI';
    case 'game_online': return 'دوئل آنلاین · Online duel';
    case 'game_local': return 'دوئل محلی · Local duel';
    case 'box_buy': return 'خرید صندوق · Chest buy';
    case 'box_open': return 'بازکردن صندوق · Chest open';
    case 'box_gift': return 'هدیهٔ صندوق · Chest gift';
    case 'gift': return 'هدیهٔ ادمین · Admin gift';
    case 'arcade_orbit': return 'آرکید اوربیت · Orbit';
    case 'arcade_synapse': return 'آرکید سیناپس · Synapse';
    case 'arcade_stellar': return 'آرکید استلار · Stellar';
    case 'purchase': return 'خرید فروشگاه · Purchase';
    case 'checkin': return 'ورود روزانه · Check-in';
    default: return type;
  }
}

/** relative time via Intl.RelativeTimeFormat (fa → «۳ دقیقه پیش») */
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function relTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let div = 1000;
  if (abs >= 86_400_000) { unit = 'day'; div = 86_400_000; }
  else if (abs >= 3_600_000) { unit = 'hour'; div = 3_600_000; }
  else if (abs >= 60_000) { unit = 'minute'; div = 60_000; }
  try {
    let rtf = rtfCache.get(locale);
    if (!rtf) {
      rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      rtfCache.set(locale, rtf);
    }
    return rtf.format(Math.round(diff / div), unit);
  } catch { return '—'; }
}

/** compact JSON summary for the event feed (max 80 chars) */
function payloadSummary(payload: unknown, max = 80): string {
  if (payload == null) return '';
  let s: string;
  try { s = JSON.stringify(payload); } catch { return ''; }
  if (!s || s === '{}' || s === '""') return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** clamp a raw text input to an int range, null when not a number */
function clampInt(raw: string, min: number, max: number): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** effective drop odds: weight ÷ total, locale digits + ٪/% sign */
function fmtPct(weight: number, total: number, locale: Locale): string {
  if (total <= 0) return '—';
  const rtl = locale === 'fa' || locale === 'ar';
  const p = (weight / total) * 100;
  const s = (Number.isInteger(p) ? String(p) : p.toFixed(1)).replace('.', rtl ? '٫' : '.');
  return localizeDigits(s, locale) + (rtl ? '٪' : '%');
}

const BOX_CODES = ['box_common', 'box_rare', 'box_epic', 'box_legendary', 'box_ultimate'] as const;
const BOX_LABEL: Record<string, string> = {
  box_common: 'صندوق عادی · Common',
  box_rare: 'صندوق کمیاب · Rare',
  box_epic: 'صندوق حماسی · Epic',
  box_legendary: 'صندوق افسانه‌ای · Legendary',
  box_ultimate: 'صندوق نهایی · Ultimate',
};

const DROP_KIND_META: Record<string, { label: string; cls: string }> = {
  COINS: { label: 'سکه · Coins', cls: 'border-amber-400/40 bg-amber-500/10 text-amber-300' },
  XP: { label: 'تجربه · XP', cls: 'border-sky-400/40 bg-sky-500/10 text-sky-300' },
  ITEM: { label: 'آیتم · Item', cls: 'border-purple-400/40 bg-purple-500/10 text-purple-300' },
};

/* ------------------------------ tiny building blocks ----------------------- */

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/5" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

function ChartCard({ title, extra, wide, children }: { title: string; extra?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`royal-card rounded-2xl p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black">{title}</h3>
        {extra}
      </div>
      <div className="h-56 w-full">{children}</div>
    </div>
  );
}

/* --------------------------------- Overview -------------------------------- */

function OverviewTab() {
  const { t, locale } = useApp();
  const { data, loading } = useAdminData<StatsDTO>('/api/admin/stats');
  const rtl = locale === 'fa' || locale === 'ar';
  const fmt = (n: number) => localizeDigits(n, locale);

  if (!data) {
    return loading ? (
      <div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white/5" />)}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white/5" />)}
        </div>
      </div>
    ) : (
      <EmptyHint>داده‌ای یافت نشد · No data available</EmptyHint>
    );
  }

  const c = data.cards;
  const ch = data.charts;
  const ec = data.economy;

  const statCards: { label: string; value: number; icon: ReactNode }[] = [
    { label: t('total_users'), value: c.totalUsers, icon: <Users className="h-5 w-5 text-amber-400" /> },
    { label: t('active_today'), value: c.activeToday, icon: <Activity className="h-5 w-5 text-emerald-400" /> },
    { label: t('games_today'), value: c.gamesToday, icon: <Swords className="h-5 w-5 text-sky-400" /> },
    { label: t('total_games'), value: c.totalGames, icon: <Gamepad2 className="h-5 w-5 text-violet-400" /> },
    { label: t('open_reports'), value: c.openReports, icon: <Flag className="h-5 w-5 text-rose-400" /> },
    { label: t('online_now'), value: c.onlineNow, icon: <Wifi className="h-5 w-5 text-green-400" /> },
    { label: 'مسدودشده‌ها · Banned', value: c.bannedUsers, icon: <Ban className="h-5 w-5 text-rose-300" /> },
    { label: 'مهمان‌ها · Guests', value: c.guests, icon: <Ghost className="h-5 w-5 text-fuchsia-400" /> },
  ];

  const winData = Object.entries(ch.winTypes).map(([k, v]) => ({ key: k, count: v, label: short(winLabel(k, t)) }));
  const modeData = Object.entries(ch.modeDist).map(([k, v]) => ({ key: k, count: v, label: short(modeLabel(k)) }));
  const fmData = ch.firstMove.map((count, col) => ({ col: localizeDigits(col, locale), count }));
  const dayData = ch.gamesPerDay.map((p) => ({ ...p, day: p.date.slice(5) }));

  const axisTick = { fontSize: 10, fill: '#94a3b8' };
  const tooltipFmt = (v: unknown) => localizeDigits(Number(v), locale);

  return (
    <div className="space-y-4">
      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="royal-card flex items-center gap-3 rounded-2xl p-3.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5">{s.icon}</div>
            <div className="min-w-0">
              <div className="truncate text-[11px] leading-tight text-muted-foreground">{s.label}</div>
              <div className="text-xl font-black gold-text">{fmt(s.value)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CSV exports */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/25 bg-sky-500/5 px-3 py-2.5">
        <Download className="h-4 w-4 text-sky-300" aria-hidden />
        <span className="text-xs font-black text-sky-200">{t('admin_export')}</span>
        <div className="ms-auto flex gap-2">
          <a
            href="/api/admin/export?type=users"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-black text-sky-200 transition-colors hover:bg-sky-500/20"
          >
            <Users className="h-3.5 w-3.5" /> {t('admin_users')}.csv
          </a>
          <a
            href="/api/admin/export?type=games"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-black text-sky-200 transition-colors hover:bg-sky-500/20"
          >
            <Swords className="h-3.5 w-3.5" /> {t('total_games')}.csv
          </a>
        </div>
      </div>

      {/* charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={t('chart_games')}
          wide
          extra={<Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-300">{t('avg_moves')}: {fmt(ch.avgMoves)}</Badge>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dayData} margin={{ top: 6, left: 4, right: 4, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" />
              <XAxis dataKey="day" reversed={rtl} tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis orientation={rtl ? 'right' : 'left'} width={32} allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => localizeDigits(Number(v), locale)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
              <Line type="monotone" dataKey="count" name={t('chart_games')} stroke="#fbbf24" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('chart_wintype')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={winData} margin={{ top: 6, left: 4, right: 4, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" />
              <XAxis dataKey="label" reversed={rtl} interval={0} tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis orientation={rtl ? 'right' : 'left'} width={32} allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => localizeDigits(Number(v), locale)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
              <Bar dataKey="count" name={t('chart_wintype')} fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('chart_modes')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={modeData} margin={{ top: 6, left: 4, right: 4, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" />
              <XAxis dataKey="label" reversed={rtl} interval={0} tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis orientation={rtl ? 'right' : 'left'} width={32} allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => localizeDigits(Number(v), locale)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
              <Bar dataKey="count" name={t('chart_modes')} fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('chart_firstmove')} wide>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={fmData} margin={{ top: 6, left: 4, right: 4, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" />
              <XAxis dataKey="col" reversed={rtl} interval={0} tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis orientation={rtl ? 'right' : 'left'} width={32} allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => localizeDigits(Number(v), locale)} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
              <Bar dataKey="count" name={t('chart_firstmove')} fill="#60a5fa" radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* economy */}
        <div className="royal-card rounded-2xl p-4 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-black">
            <ShoppingBag className="h-4 w-4 text-amber-400" /> اقتصاد بازی · Economy
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 p-2.5">
              <div className="text-lg font-black text-amber-300">{fmt(ec.coinsMinted)}</div>
              <div className="text-[10px] text-muted-foreground">سکه ضرب‌شده · Minted</div>
            </div>
            <div className="rounded-xl bg-white/5 p-2.5">
              <div className="text-lg font-black text-amber-300">{fmt(ec.coinsSpent)}</div>
              <div className="text-[10px] text-muted-foreground">سکه خرج‌شده · Spent</div>
            </div>
            <div className="rounded-xl bg-white/5 p-2.5">
              <div className="text-lg font-black text-amber-300">{fmt(ec.purchases)}</div>
              <div className="text-[10px] text-muted-foreground">خرید · Purchases</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold text-muted-foreground">پرفروش‌ترین آیتم‌ها · Top items</div>
            <div className="space-y-1.5">
              {ec.topItems.map((it, i) => (
                <div key={it.code} className="flex items-center gap-2 rounded-lg bg-white/[.03] px-2.5 py-1.5 text-xs">
                  <span className="font-black text-amber-400/70">{fmt(i + 1)}</span>
                  <span className="font-bold" dir="ltr">{it.code}</span>
                  <span className="text-muted-foreground">{t(`cat_${it.category}` as TKey)}</span>
                  <span className="ms-auto font-bold">{fmt(it.sales)} فروش · sold</span>
                  <span className="w-20 text-end font-black text-amber-300">{fmt(it.price)} 🪙</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Users ---------------------------------- */

function BanDialog({ target, busy, onClose, onSubmit }: {
  target: AdminUser; busy: boolean;
  onClose: () => void;
  onSubmit: (p: { days: number; permanent: boolean; reason?: string }) => Promise<boolean>;
}) {
  const { t } = useApp();
  const [permanent, setPermanent] = useState(false);
  const [days, setDays] = useState('3');
  const [reason, setReason] = useState('');

  const submit = async () => {
    const ok = await onSubmit({
      days: permanent ? 0 : Math.max(0, Math.floor(Number(days) || 0)),
      permanent,
      reason: reason.trim() || undefined,
    });
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="royal-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="gold-text">{t('ban')} — <span dir="ltr">{target.username}</span></DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
            <span className="text-sm font-bold">{t('permanent')}</span>
            <Switch checked={permanent} onCheckedChange={setPermanent} aria-label="permanent ban" />
          </div>
          {!permanent && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{t('days')} (۰ تا ۳۶۵۰ · 0–3650)</span>
              <Input type="number" min={0} max={3650} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('reason')}</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="دلیل مسدودی · Ban reason" />
          </label>
          <Button variant="destructive" className="w-full" disabled={busy || (!permanent && days === '')} onClick={() => void submit()}>
            <Ban className="h-4 w-4" /> {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoinDialog({ target, busy, onClose, onSubmit }: {
  target: AdminUser; busy: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => Promise<boolean>;
}) {
  const { t, locale } = useApp();
  const [amount, setAmount] = useState('100');
  const n = Math.floor(Number(amount));
  const valid = Number.isFinite(n) && n !== 0 && Math.abs(n) <= 100000;

  const submit = async () => {
    if (!valid) return;
    const ok = await onSubmit(n);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="royal-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 gold-text">
            <Coins className="h-5 w-5 text-amber-400" /> {t('grant_coins')} — <span dir="ltr">{target.username}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">{t('coins')}: <b className="text-foreground">{localizeDigits(target.coins, locale)}</b></div>
          <Input type="number" dir="ltr" min={-100000} max={100000} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {[100, 500, 1000, -100].map((d) => (
              <button
                key={d}
                type="button"
                dir="ltr"
                onClick={() => setAmount(String((Number(amount) || 0) + d))}
                className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-black text-amber-300 transition-colors hover:bg-amber-400/20"
              >
                {d > 0 ? `+${d}` : String(d)}
              </button>
            ))}
          </div>
          <Button className="w-full glow-gold" disabled={busy || !valid} onClick={() => void submit()}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoleConfirm({ target, busy, onClose, onSubmit }: {
  target: { id: string; name: string; action: 'promote' | 'demote' }; busy: boolean;
  onClose: () => void;
  onSubmit: () => Promise<boolean>;
}) {
  const { t } = useApp();
  const promote = target.action === 'promote';
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="royal-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="gold-text">{promote ? t('make_admin') : t('remove_admin')}</AlertDialogTitle>
          <AlertDialogDescription>
            {promote
              ? 'این کاربر دسترسی مدیریتی کامل می‌گیرد · This grants full admin access'
              : 'دسترسی مدیریتی این کاربر برداشته می‌شود · Admin access will be revoked'}
            {' '}— <b dir="ltr">{target.name}</b>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); void onSubmit().then((ok) => { if (ok) onClose(); }); }}
          >
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UsersTab() {
  const { t, locale, user: me } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);

  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [coinTarget, setCoinTarget] = useState<AdminUser | null>(null);
  const [roleTarget, setRoleTarget] = useState<{ id: string; name: string; action: 'promote' | 'demote' } | null>(null);
  const [detailTarget, setDetailTarget] = useState<AdminUser | null>(null);

  /* debounced search */
  useEffect(() => {
    const id = setTimeout(() => { setDq(q.trim()); setPage(0); }, 400);
    return () => clearTimeout(id);
  }, [q]);

  const { data, loading, refresh } = useAdminData<UsersDTO>(`/api/admin/users?q=${encodeURIComponent(dq)}&page=${page}`);
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const act = async (
    userId: string,
    action: 'ban' | 'unban' | 'grant_coins' | 'promote' | 'demote',
    extra?: { days?: number; permanent?: boolean; reason?: string; amount?: number },
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await api.post('/api/admin/users', { userId, action, ...extra });
      toast.success(t('success'));
      refresh();
      return true;
    } catch (e) {
      toast.error(apiErrMsg(e, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}…`} maxLength={32} className="ps-9" />
      </div>

      {loading && !data ? <ListSkeleton rows={6} /> : (
        <div className="royal-card rounded-2xl">
          <div className="overflow-x-auto nice-scroll">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow className="border-amber-500/15 hover:bg-transparent">
                  <TableHead>{t('username')}</TableHead>
                  <TableHead>{t('level')}</TableHead>
                  <TableHead>رنکینگ · Rating</TableHead>
                  <TableHead>{t('coins')}</TableHead>
                  <TableHead>{t('games_played')}</TableHead>
                  <TableHead>{t('role')}</TableHead>
                  <TableHead>{t('banned_label')}</TableHead>
                  <TableHead>{t('member_since')}</TableHead>
                  <TableHead>آخرین بازدید · Last seen</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const online = u.lastSeen ? Date.now() - new Date(u.lastSeen).getTime() < 5 * 60_000 : false;
                  return (
                    <TableRow key={u.id} className="border-amber-500/10">
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.9)]' : 'bg-white/10'}`} />
                          <button
                            className="font-bold underline-offset-4 transition-colors hover:text-amber-300 hover:underline"
                            onClick={() => setDetailTarget(u)}
                            title="پروفایل کامل · Full profile"
                          >
                            {u.username}
                          </button>
                          {u.isGuest && <Badge variant="outline" className="border-slate-400/30 bg-slate-500/10 text-[9px] text-slate-300">{t('guest')}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{fmt(u.level)}</TableCell>
                      <TableCell>{fmt(u.rating)}</TableCell>
                      <TableCell className="font-bold text-amber-300">{fmt(u.coins)}</TableCell>
                      <TableCell>{fmt(u.gamesPlayed)}</TableCell>
                      <TableCell>
                        {u.role === 'ADMIN'
                          ? <Badge variant="outline" className="border-amber-400/40 bg-amber-500/15 text-amber-300">مدیر · Admin</Badge>
                          : <span className="text-xs text-muted-foreground">بازیکن · Player</span>}
                      </TableCell>
                      <TableCell>
                        {u.banned ? (
                          <div className="space-y-0.5">
                            <Badge variant="outline" className="border-rose-400/40 bg-rose-500/15 text-rose-300">{t('banned_label')}</Badge>
                            <div className="max-w-36 truncate text-[10px] text-rose-300/70" dir="auto">{u.banReason ?? '—'}</div>
                            {u.bannedUntil && <div className="text-[10px] text-muted-foreground">تا · until {fmtDate(u.bannedUntil, locale)}</div>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(u.createdAt, locale)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDateTime(u.lastSeen, locale)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`actions ${u.username}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem className="gap-2" onClick={() => setDetailTarget(u)}>
                              <Eye className="h-4 w-4 text-sky-400" /> پروفایل کامل · Full profile
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => setCoinTarget(u)}>
                              <Coins className="h-4 w-4 text-amber-400" /> {t('grant_coins')}
                            </DropdownMenuItem>
                            {u.role !== 'ADMIN' && !u.banned && (
                              <DropdownMenuItem className="gap-2 text-rose-300 focus:text-rose-300" onClick={() => setBanTarget(u)}>
                                <Ban className="h-4 w-4" /> {t('ban')}
                              </DropdownMenuItem>
                            )}
                            {u.banned && (
                              <DropdownMenuItem className="gap-2" onClick={() => void act(u.id, 'unban')}>
                                <UserCheck className="h-4 w-4 text-emerald-400" /> {t('unban')}
                              </DropdownMenuItem>
                            )}
                            {u.role !== 'ADMIN' && (
                              <DropdownMenuItem className="gap-2" onClick={() => setRoleTarget({ id: u.id, name: u.username, action: 'promote' })}>
                                <ShieldCheck className="h-4 w-4 text-amber-400" /> {t('make_admin')}
                              </DropdownMenuItem>
                            )}
                            {u.role === 'ADMIN' && u.id !== me?.id && (
                              <DropdownMenuItem className="gap-2 text-rose-300 focus:text-rose-300" onClick={() => setRoleTarget({ id: u.id, name: u.username, action: 'demote' })}>
                                <ShieldOff className="h-4 w-4" /> {t('remove_admin')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">کاربری یافت نشد · No users found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{t('total_users')}: <b className="text-foreground">{fmt(total)}</b></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="previous page">
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <span className="min-w-28 text-center text-xs font-bold">صفحه {fmt(page + 1)} / {fmt(totalPages)} · Page</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * 25 >= total} onClick={() => setPage((p) => p + 1)} aria-label="next page">
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>

      {detailTarget && (
        <UserDetailSheet
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          act={act}
          onOpenBan={() => setBanTarget(detailTarget)}
        />
      )}
      {banTarget && (
        <BanDialog
          target={banTarget}
          busy={busy}
          onClose={() => setBanTarget(null)}
          onSubmit={(p) => act(banTarget.id, 'ban', { days: p.days, permanent: p.permanent, reason: p.reason })}
        />
      )}
      {coinTarget && (
        <CoinDialog
          target={coinTarget}
          busy={busy}
          onClose={() => setCoinTarget(null)}
          onSubmit={(amount) => act(coinTarget.id, 'grant_coins', { amount })}
        />
      )}
      {roleTarget && (
        <RoleConfirm
          target={roleTarget}
          busy={busy}
          onClose={() => setRoleTarget(null)}
          onSubmit={() => act(roleTarget.id, roleTarget.action)}
        />
      )}
    </div>
  );
}

/* ------------------------------ User detail ------------------------------- */

interface DetailUser {
  id: string; username: string; role: string; isGuest: boolean; banned: boolean;
  banReason: string | null; bannedUntil: string | null; banCount: number;
  coins: number; xp: number; level: number; rating: number;
  wins: number; losses: number; draws: number; gamesPlayed: number;
  streak: number; bestStreak: number; bio: string; locale: string;
  pieceSkin: string; boardSkin: string; background: string; effectSkin: string;
  avatarItem: string; titleItem: string; showcase: string[]; checkinStreak: number;
  createdAt: string; lastSeen: string | null;
}
interface DetailMatch {
  id: string; mode: string; aiLevel: string | null; winner: string; endReason: string;
  p1Id: string | null; p2Id: string | null; p1Name: string; p2Name: string;
  p1RatingDelta: number; p2RatingDelta: number; moves: number; createdAt: string;
}
interface DetailDTO {
  user: DetailUser;
  matches: DetailMatch[];
  purchases: { id: string; itemId: string; price: number; createdAt: string }[];
  reportsAgainst: number; reportsBy: number;
}

function UserDetailSheet({ target, onClose, act, onOpenBan }: {
  target: AdminUser; onClose: () => void;
  act: (userId: string, action: 'ban' | 'unban' | 'grant_coins' | 'promote' | 'demote', extra?: { days?: number; permanent?: boolean; reason?: string; amount?: number }) => Promise<boolean>;
  onOpenBan: () => void;
}) {
  const { t, locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);
  const [data, setData] = useState<DetailDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [coinAmount, setCoinAmount] = useState('');
  const [busyLocal, setBusyLocal] = useState(false);

  const reload = useCallback(() => {
    api.get<DetailDTO>(`/api/admin/users?userId=${encodeURIComponent(target.id)}`)
      .then((d) => setData(d))
      .catch(() => setFailed(true));
  }, [target.id]);

  useEffect(() => {
    let alive = true;
    api.get<DetailDTO>(`/api/admin/users?userId=${encodeURIComponent(target.id)}`)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [target.id]);

  const quickAct = async (action: 'unban' | 'grant_coins' | 'promote' | 'demote', extra?: { amount?: number }) => {
    setBusyLocal(true);
    const ok = await act(target.id, action, extra);
    setBusyLocal(false);
    if (ok) { if (action === 'grant_coins') setCoinAmount(''); reload(); }
  };

  const [roleConfirm, setRoleConfirm] = useState(false);

  const endLabel = (e: string) =>
    e === 'KIND' ? t('win_kind') : e === 'RUN' ? t('win_run') : e === 'FULL' ? t('draw_full') : e === 'RESIGN' ? t('resign') : e === 'TIMEOUT' ? t('timeout_win') : e;

  const modeBadge = (m: string) =>
    m === 'PVE'
      ? { label: t('mode_ai'), cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' }
      : m === 'ONLINE'
        ? { label: t('online'), cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' }
        : { label: t('mode_local'), cls: 'border-violet-500/40 bg-violet-500/10 text-violet-300' };

  const xpNeed = 100 + 60 * (target.level - 1);
  const stat = (label: string, value: string, cls = 'text-foreground') => (
    <div className="rounded-lg border border-amber-500/10 bg-muted/40 p-2 text-center">
      <div className={`text-base font-black ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="royal-card nice-scroll w-full overflow-y-auto p-0 sm:max-w-md" dir="auto">
        <SheetHeader className="border-b border-amber-500/15 p-4 text-start">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/40 to-fuchsia-600/30 text-sm font-black text-amber-200">
              {target.username.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-black">{target.username}</span>
            {target.role === 'ADMIN' && <Badge variant="outline" className="border-amber-400/40 bg-amber-500/15 text-amber-300">مدیر · Admin</Badge>}
            {target.isGuest && <Badge variant="outline" className="border-slate-400/30 bg-slate-500/10 text-[9px] text-slate-300">{t('guest')}</Badge>}
            {target.banned && <Badge variant="outline" className="border-rose-400/40 bg-rose-500/15 text-rose-300">{t('banned_label')}</Badge>}
          </SheetTitle>
        </SheetHeader>

        {!data && !failed && (
          <div className="space-y-2 p-4">
            <ListSkeleton rows={5} />
          </div>
        )}
        {failed && (
          <div className="p-4 text-sm text-rose-300">خطا در بارگذاری · Failed to load profile</div>
        )}

        {data && (
          <div className="space-y-4 p-4">
            {/* quick actions (R7) */}
            <div className="rounded-xl border border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-transparent p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-amber-300">
                <Zap className="h-3.5 w-3.5" /> {t('quick_actions')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-44 flex-1 items-center gap-1.5">
                  <Input
                    value={coinAmount}
                    onChange={(e) => setCoinAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="250"
                    className="h-8 w-24"
                    dir="ltr"
                    inputMode="numeric"
                    aria-label={t('grant_coins')}
                  />
                  <Button size="sm" variant="secondary" className="h-8" disabled={busyLocal || !coinAmount || Number(coinAmount) <= 0} onClick={() => void quickAct('grant_coins', { amount: Number(coinAmount) })}>
                    <Coins className="h-3.5 w-3.5 text-amber-400" /> {t('grant_coins')}
                  </Button>
                </div>
                {(data.user.banned || target.banned) ? (
                  <Button size="sm" variant="outline" className="h-8 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15" disabled={busyLocal} onClick={() => void quickAct('unban')}>
                    <UserCheck className="h-3.5 w-3.5" /> {t('unban')}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 border-rose-500/40 text-rose-300 hover:bg-rose-500/10" disabled={busyLocal || data.user.role === 'ADMIN'} onClick={onOpenBan}>
                    <Ban className="h-3.5 w-3.5" /> {t('ban')}
                  </Button>
                )}
                {/* inline role change (R8) — mirrors the row dropdown, with its own confirm */}
                {data.user.role === 'ADMIN' ? (
                  <Button size="sm" variant="outline" className="h-8 border-slate-400/40 text-slate-300 hover:bg-slate-500/10" disabled={busyLocal} onClick={() => setRoleConfirm(true)}>
                    <ShieldOff className="h-3.5 w-3.5" /> {t('remove_admin')}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 border-amber-400/40 text-amber-300 hover:bg-amber-500/10" disabled={busyLocal} onClick={() => setRoleConfirm(true)}>
                    <ShieldCheck className="h-3.5 w-3.5" /> {t('make_admin')}
                  </Button>
                )}
              </div>
            </div>

            {/* role change confirm (inline in sheet) */}
            <AlertDialog open={roleConfirm} onOpenChange={setRoleConfirm}>
              <AlertDialogContent dir="rtl" className="royal-card">
                <AlertDialogHeader>
                  <AlertDialogTitle className="gold-text">
                    {data.user.role === 'ADMIN' ? t('remove_admin') : t('make_admin')} — <span dir="ltr">{target.username}</span>
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {data.user.role === 'ADMIN'
                      ? 'این کاربر دسترسی مدیریتی را از دست می‌دهد · This revokes full admin access'
                      : 'این کاربر دسترسی مدیریتی کامل می‌گیرد · This grants full admin access'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    className={data.user.role === 'ADMIN' ? 'bg-slate-600 text-white hover:bg-slate-700' : 'bg-amber-500 text-amber-950 hover:bg-amber-400'}
                    onClick={() => { void quickAct(data.user.role === 'ADMIN' ? 'demote' : 'promote'); setRoleConfirm(false); }}
                  >
                    {t('confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* identity + economy */}
            <div className="grid grid-cols-3 gap-2">
              {stat(t('coins'), fmt(data.user.coins), 'text-amber-300')}
              {stat(t('level'), fmt(data.user.level), 'text-sky-300')}
              {stat('رنکینگ · Rating', fmt(data.user.rating), 'text-fuchsia-300')}
              {stat(t('wins'), fmt(data.user.wins), 'text-emerald-300')}
              {stat(t('losses'), fmt(data.user.losses), 'text-rose-300')}
              {stat(t('games_played'), fmt(data.user.gamesPlayed))}
              {stat(`${t('wins')} 🔥`, `${fmt(data.user.streak)}/${fmt(data.user.bestStreak)}`)}
              {stat('حضور روزانه · Check-in', fmt(data.user.checkinStreak))}
              {stat('بن‌ها · Bans', fmt(data.user.banCount), data.user.banCount > 0 ? 'text-rose-300' : 'text-foreground')}
            </div>

            {/* xp progress */}
            <div className="rounded-xl border border-amber-500/10 bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold">
                <span>XP</span>
                <span className="text-muted-foreground">{fmt(data.user.xp)} / {fmt(xpNeed)}</span>
              </div>
              <Progress value={Math.min(100, (data.user.xp / xpNeed) * 100)} className="h-2" />
            </div>

            {/* meta */}
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <div>{t('member_since')}: <b className="text-foreground">{fmtDate(data.user.createdAt, locale)}</b></div>
              <div>آخرین بازدید · Last seen: <b className="text-foreground">{fmtDateTime(data.user.lastSeen, locale)}</b></div>
              {data.user.banned && data.user.banReason && (
                <div className="text-rose-300">{t('banned_label')}: {data.user.banReason}{data.user.bannedUntil ? ` — ${fmtDate(data.user.bannedUntil, locale)}` : ' (دائمی · permanent)'}</div>
              )}
              {data.user.bio && <div dir="auto" className="rounded-lg bg-muted/40 p-2 leading-relaxed text-foreground">“{data.user.bio}”</div>}
              {/* cosmetics */}
              <div className="flex flex-wrap gap-1 pt-1">
                {[['🪙', data.user.pieceSkin], ['🎮', data.user.boardSkin], ['🖼', data.user.background], ['✨', data.user.effectSkin], ['🙂', data.user.avatarItem], ['👑', data.user.titleItem]]
                  .filter(([, code]) => !!code)
                  .map(([icon, code], i) => (
                    <span key={i} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px]" dir="ltr">{icon} {code}</span>
                  ))}
              </div>
            </div>

            {/* reports */}
            <div className="grid grid-cols-2 gap-2">
              {stat('گزارش علیه · Reported', fmt(data.reportsAgainst), data.reportsAgainst > 0 ? 'text-rose-300' : 'text-foreground')}
              {stat('گزارش داده · Filed', fmt(data.reportsBy))}
            </div>

            {/* purchases */}
            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-black"><ShoppingBag className="h-3.5 w-3.5 text-amber-400" /> خریدها · Purchases ({fmt(data.purchases.length)})</h4>
              <div className="max-h-32 space-y-1 overflow-y-auto nice-scroll rounded-xl border border-amber-500/10 p-2">
                {data.purchases.length === 0 && <div className="py-2 text-center text-[11px] text-muted-foreground">—</div>}
                {data.purchases.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono" dir="ltr">{p.itemId}</span>
                    <span className="shrink-0 text-amber-300">🪙{fmt(p.price)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* matches */}
            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-black"><Swords className="h-3.5 w-3.5 text-amber-400" /> نبردهای اخیر · Recent duels ({fmt(data.matches.length)})</h4>
              <div className="max-h-64 space-y-1.5 overflow-y-auto nice-scroll">
                {data.matches.length === 0 && <div className="py-3 text-center text-[11px] text-muted-foreground">—</div>}
                {data.matches.map((m) => {
                  const mb = modeBadge(m.mode);
                  const isP1 = m.p1Id === target.id;
                  const opp = isP1 ? (m.p2Name || '—') : (m.p1Name || '—');
                  const won = (isP1 && m.winner === 'P1') || (!isP1 && m.winner === 'P2');
                  const draw = m.winner === 'DRAW';
                  const delta = isP1 ? m.p1RatingDelta : m.p2RatingDelta;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/10 bg-muted/30 px-2 py-1.5 text-[11px]">
                      <Badge variant="outline" className={`text-[9px] ${mb.cls}`}>{mb.label}</Badge>
                      <span className="min-w-0 flex-1 truncate" dir="auto">vs <b>{opp}</b></span>
                      <span className={`font-black ${draw ? 'text-muted-foreground' : won ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {draw ? '=' : won ? '✓' : '✗'}
                      </span>
                      <span className="text-muted-foreground">{endLabel(m.endReason)}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{delta !== 0 ? `${delta > 0 ? '+' : ''}${fmt(delta)}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* --------------------------------- Reports --------------------------------- */

function ReportsTab() {
  const { t, locale } = useApp();
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'ACTIONED' | 'DISMISSED'>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const url = status === 'ALL' ? '/api/admin/reports' : `/api/admin/reports?status=${status}`;
  const { data, loading, refresh } = useAdminData<{ reports: AdminReport[] }>(url);
  const reports = data?.reports ?? [];

  const act = async (reportId: string, action: 'dismiss' | 'ban7' | 'banPerm') => {
    setBusyId(reportId);
    try {
      await api.post('/api/admin/reports', { reportId, action });
      toast.success(t('success'));
      refresh();
    } catch (e) {
      toast.error(apiErrMsg(e, t));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* status filter */}
      <div className="flex flex-wrap gap-1.5">
        {(['ALL', 'OPEN', 'ACTIONED', 'DISMISSED'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              status === s
                ? 'border border-amber-400/40 bg-amber-400/20 text-amber-300'
                : 'border border-white/10 text-muted-foreground hover:bg-muted'
            }`}
          >
            {s === 'ALL' ? 'همه · All' : t(`status_${s}` as TKey)}
          </button>
        ))}
      </div>

      {loading && !data ? <ListSkeleton rows={4} /> : reports.length === 0 ? (
        <EmptyHint>گزارشی نیست · No reports</EmptyHint>
      ) : (
        <div className="space-y-2.5">
          {reports.map((r) => (
            <div key={r.id} className="royal-card rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Flag className="h-4 w-4 shrink-0 text-rose-400" />
                <span className="font-black">{r.target?.username ?? r.targetName}</span>
                <Badge variant="outline" className="border-purple-400/40 bg-purple-500/10 text-purple-300">
                  {t(`report_reason_${r.reason}` as TKey)}
                </Badge>
                <Badge variant="outline" className={STATUS_STYLE[r.status] ?? ''}>
                  {t(`status_${r.status}` as TKey)}
                </Badge>
                <span className="ms-auto text-[11px] text-muted-foreground">{fmtDateTime(r.createdAt, locale)}</span>
              </div>
              {r.details && <p className="mt-2 text-sm leading-relaxed" dir="auto">{r.details}</p>}
              {r.chatExcerpt && (
                <blockquote className="mt-2 rounded-lg bg-white/[.04] p-2 text-xs text-muted-foreground" dir="auto">
                  «{r.chatExcerpt}»
                </blockquote>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{t('reported_player')}: <b className="text-foreground">{r.target?.username ?? r.targetName}</b></span>
                <span>گزارش‌دهنده · Reporter: <b className="text-foreground">{r.reporter?.username ?? '—'}</b></span>
              </div>
              {r.status === 'OPEN' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void act(r.id, 'dismiss')}>
                    <X className="h-3.5 w-3.5" /> {t('action_dismiss')}
                  </Button>
                  <Button size="sm" variant="outline" className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200" disabled={busyId === r.id} onClick={() => void act(r.id, 'ban7')}>
                    <Ban className="h-3.5 w-3.5" /> {t('action_ban7')}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => void act(r.id, 'banPerm')}>
                    <Ban className="h-3.5 w-3.5" /> {t('action_ban_perm')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Content --------------------------------- */

interface AnnForm { titleFa: string; titleEn: string; titleAr: string; titleTr: string; bodyFa: string; bodyEn: string; bodyAr: string; bodyTr: string }

const ANN_FIELDS: { key: keyof AnnForm; label: string; dir: 'rtl' | 'ltr'; max: number }[] = [
  { key: 'titleFa', label: 'عنوان فارسی · Title FA', dir: 'rtl', max: 120 },
  { key: 'titleEn', label: 'عنوان انگلیسی · Title EN', dir: 'ltr', max: 120 },
  { key: 'titleAr', label: 'عنوان عربی · Title AR', dir: 'rtl', max: 120 },
  { key: 'titleTr', label: 'عنوان ترکی · Title TR', dir: 'ltr', max: 120 },
  { key: 'bodyFa', label: 'متن فارسی · Body FA', dir: 'rtl', max: 500 },
  { key: 'bodyEn', label: 'متن انگلیسی · Body EN', dir: 'ltr', max: 500 },
  { key: 'bodyAr', label: 'متن عربی · Body AR', dir: 'rtl', max: 500 },
  { key: 'bodyTr', label: 'متن ترکی · Body TR', dir: 'ltr', max: 500 },
];

function AnnounceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState<AnnForm>({ titleFa: '', titleEn: '', titleAr: '', titleTr: '', bodyFa: '', bodyEn: '', bodyAr: '', bodyTr: '' });
  const [kind, setKind] = useState<'INFO' | 'EVENT' | 'WARNING'>('INFO');
  const [busy, setBusy] = useState(false);
  const valid = ANN_FIELDS.every((f) => form[f.key].trim().length >= 2);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post('/api/admin/announcements', { ...form, kind });
      toast.success(t('success'));
      onCreated();
      onClose();
    } catch {
      toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="royal-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 gold-text"><Megaphone className="h-5 w-5 text-amber-400" /> {t('announce')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('announce_hint')}</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {ANN_FIELDS.map((f) => (
            <label key={f.key} className="space-y-1">
              <span className="text-[11px] text-muted-foreground">{f.label}</span>
              <Input
                dir={f.dir}
                maxLength={f.max}
                value={form[f.key]}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">نوع · Kind</span>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['INFO', 'EVENT', 'WARNING'] as const).map((k) => (
                <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="w-full glow-gold" disabled={busy || !valid} onClick={() => void submit()}>
          {t('confirm')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ContentTab() {
  const { t, locale } = useApp();
  const words = useAdminData<{ words: BannedWordRow[] }>('/api/admin/words');
  const anns = useAdminData<{ announcements: AnnouncementRow[] }>('/api/admin/announcements');
  const [newWord, setNewWord] = useState('');
  const [sev, setSev] = useState('2');
  const [adding, setAdding] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);

  const wordList = words.data?.words ?? [];
  const annList = anns.data?.announcements ?? [];

  const addWord = async () => {
    const w = newWord.trim().toLowerCase();
    if (w.length < 2) return;
    setAdding(true);
    try {
      await api.post('/api/admin/words', { word: w, severity: Number(sev) });
      toast.success(t('success'));
      setNewWord('');
      words.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setAdding(false);
    }
  };

  const delWord = async (id: string) => {
    try {
      await api.del(`/api/admin/words?id=${encodeURIComponent(id)}`);
      toast.success(t('success'));
      words.refresh();
    } catch {
      toast.error(t('error'));
    }
  };

  const toggleAnn = async (a: AnnouncementRow, active: boolean) => {
    anns.patch((d) => ({ ...d, announcements: d.announcements.map((x) => (x.id === a.id ? { ...x, active } : x)) }));
    try {
      await api.patch('/api/admin/announcements', { id: a.id, active });
      toast.success(t('success'));
    } catch {
      toast.error(t('error'));
      anns.refresh();
    }
  };

  const pickTitle = (a: AnnouncementRow) => ({ fa: a.titleFa, en: a.titleEn, ar: a.titleAr, tr: a.titleTr }[locale] ?? a.titleFa);
  const pickBody = (a: AnnouncementRow) => ({ fa: a.bodyFa, en: a.bodyEn, ar: a.bodyAr, tr: a.bodyTr }[locale] ?? a.bodyFa);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* word filter */}
      <div className="royal-card rounded-2xl p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black"><Filter className="h-4 w-4 text-sky-400" /> {t('words_title')}</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addWord(); }}
            placeholder="واژهٔ تازه · new word"
            maxLength={40}
            className="min-w-32 flex-1"
          />
          <Select value={sev} onValueChange={setSev}>
            <SelectTrigger className="w-32 shrink-0" aria-label={t('severity')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {['1', '2', '3'].map((s) => (
                <SelectItem key={s} value={s}>{t(`sev_${s}` as TKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="shrink-0" disabled={newWord.trim().length < 2 || adding} onClick={() => void addWord()}>
            <Plus className="h-4 w-4" /> {t('add_word')}
          </Button>
        </div>
        {words.loading && !words.data ? <ListSkeleton rows={5} /> : wordList.length === 0 ? (
          <EmptyHint>واژه‌ای نیست · No words</EmptyHint>
        ) : (
          <div className="max-h-80 space-y-1.5 overflow-y-auto nice-scroll pe-1">
            {wordList.map((w) => (
              <div key={w.id} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-3 py-2">
                <span className="text-sm font-bold" dir="ltr">{w.word}</span>
                <Badge variant="outline" className={`ms-auto shrink-0 text-[10px] ${SEV_STYLE[w.severity] ?? ''}`}>
                  {t(`sev_${w.severity}` as TKey)}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  onClick={() => void delWord(w.id)}
                  aria-label={`delete ${w.word}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* announcements */}
      <div className="royal-card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black"><Megaphone className="h-4 w-4 text-amber-400" /> اطلاعیه‌ها · Announcements</h3>
          <Button size="sm" variant="outline" className="border-amber-400/40 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200" onClick={() => setAnnOpen(true)}>
            <Plus className="h-4 w-4" /> {t('announce')}
          </Button>
        </div>
        {anns.loading && !anns.data ? <ListSkeleton rows={4} /> : annList.length === 0 ? (
          <EmptyHint>اطلاعیه‌ای نیست · No announcements</EmptyHint>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto nice-scroll pe-1">
            {annList.map((a) => (
              <div key={a.id} className="rounded-xl bg-white/[.04] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{pickTitle(a)}</span>
                  <Badge variant="outline" className={`text-[10px] ${KIND_STYLE[a.kind] ?? ''}`}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                  <div className="ms-auto flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{fmtDate(a.createdAt, locale)}</span>
                    <Switch checked={a.active} onCheckedChange={(v) => void toggleAnn(a, v)} aria-label={`announce ${a.id}`} />
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">{pickBody(a)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {annOpen && <AnnounceDialog onClose={() => setAnnOpen(false)} onCreated={anns.refresh} />}
    </div>
  );
}

/* ---------------------------------- Store ---------------------------------- */

function StoreTab() {
  const { t, locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);
  const { data, patch, loading, refresh } = useAdminData<{ items: ItemRow[] }>('/api/admin/items');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const items = data?.items ?? [];

  const savePrice = async (it: ItemRow) => {
    const raw = drafts[it.code];
    if (raw === undefined || !Number.isFinite(Number(raw))) return;
    const price = Math.max(0, Math.floor(Number(raw)));
    try {
      await api.post('/api/admin/items', { code: it.code, price });
      patch((d) => ({ ...d, items: d.items.map((x) => (x.code === it.code ? { ...x, price } : x)) }));
      setDrafts((dr) => { const n = { ...dr }; delete n[it.code]; return n; });
      toast.success(`${it.code} — ${t('success')}`);
    } catch {
      toast.error(t('error'));
    }
  };

  const toggleActive = async (it: ItemRow, active: boolean) => {
    patch((d) => ({ ...d, items: d.items.map((x) => (x.code === it.code ? { ...x, active } : x)) }));
    try {
      await api.post('/api/admin/items', { code: it.code, active });
      toast.success(t('success'));
    } catch {
      toast.error(t('error'));
      refresh();
    }
  };

  return loading && !data ? <ListSkeleton rows={6} /> : (
    <div className="royal-card rounded-2xl">
      <div className="overflow-x-auto nice-scroll">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="border-amber-500/15 hover:bg-transparent">
              <TableHead>کد · Code</TableHead>
              <TableHead>دسته · Category</TableHead>
              <TableHead>کمیابی · Rarity</TableHead>
              <TableHead>قیمت · Price</TableHead>
              <TableHead>فعال · Active</TableHead>
              <TableHead>خریداران · Buyers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const raw = drafts[it.code];
              const changed = raw !== undefined && raw !== String(it.price) && Number.isFinite(Number(raw)) && Number(raw) >= 0;
              return (
                <TableRow key={it.code} className="border-amber-500/10">
                  <TableCell className="font-bold" dir="ltr">{it.code}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t(`cat_${it.category}` as TKey)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={RARITY_STYLE[it.rarity] ?? ''}>{t(`rarity_${it.rarity}` as TKey)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        dir="ltr"
                        type="number"
                        min={0}
                        max={100000}
                        className="h-8 w-24"
                        value={raw ?? String(it.price)}
                        onChange={(e) => setDrafts((d) => ({ ...d, [it.code]: e.target.value }))}
                        aria-label={`price ${it.code}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
                        disabled={!changed}
                        onClick={() => void savePrice(it)}
                        aria-label={`save price ${it.code}`}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch checked={it.active} onCheckedChange={(v) => void toggleActive(it, v)} aria-label={`active ${it.code}`} />
                  </TableCell>
                  <TableCell className="font-bold">{fmt(it.purchasedBy)}</TableCell>
                </TableRow>
              );
            })}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">آیتمی نیست · No items</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* --------------------------------- Chats ----------------------------------- */

function ChatsTab() {
  const { locale } = useApp();
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const { data, loading } = useAdminData<{ chats: ChatRow[] }>(`/api/admin/items?view=chats&flagged=${flaggedOnly ? 1 : 0}`);
  const chats = data?.chats ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] px-3 py-2">
        <span className="text-sm font-bold">فقط پیام‌های پرچم‌خورده · Flagged only</span>
        <Switch checked={flaggedOnly} onCheckedChange={setFlaggedOnly} aria-label="flagged only" />
      </div>

      {loading && !data ? <ListSkeleton rows={6} /> : chats.length === 0 ? (
        <EmptyHint>پیامی نیست · No messages</EmptyHint>
      ) : (
        <div className="space-y-2">
          {chats.map((c) => {
            const flags = c.flaggedWords.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
            return (
              <div key={c.id} className="royal-card rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <b>{c.sender?.username ?? c.senderName}</b>
                  {c.sender?.banned && <Badge variant="outline" className="border-rose-400/40 bg-rose-500/15 text-[9px] text-rose-300">مسدود · Banned</Badge>}
                  {c.masked && <Badge variant="outline" className="border-amber-400/40 bg-amber-500/10 text-[9px] text-amber-300">پالایش‌شده · Masked</Badge>}
                  <span className="ms-auto text-[10px] text-muted-foreground">{fmtDateTime(c.createdAt, locale)}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed" dir="auto">{c.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-muted-foreground">اتاق · Room: {c.roomId || '—'}</span>
                  {flags.map((fw) => (
                    <span key={fw} className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300" dir="ltr">{fw}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Market & gifting ----------------------------- */
/* task 6-b: Gifting Center + Developer Cheat Engine (admin only, audited)    */

function MarketTab() {
  const { t, locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);
  const store = useAdminData<{ items: StoreItemRow[] }>('/api/store');
  const items = store.data?.items ?? [];
  const cats = [...new Set(items.map((i) => i.category))];

  /* — gift form — */
  const [gUser, setGUser] = useState('');
  const [gAll, setGAll] = useState(false);
  const [gCoins, setGCoins] = useState('');
  const [gXp, setGXp] = useState('');
  const [gItem, setGItem] = useState('');
  const [gBox, setGBox] = useState('');
  const [gNote, setGNote] = useState('');
  const [gBusy, setGBusy] = useState(false);

  const coinsN = clampInt(gCoins, 0, 1_000_000) ?? 0;
  const xpN = clampInt(gXp, 0, 1_000_000) ?? 0;
  const giftValid = (gAll || gUser.trim().length >= 2) && (coinsN > 0 || xpN > 0 || !!gItem || !!gBox);

  const giftErrMsg = (e: unknown): string => {
    const code = (e as Error)?.message ?? '';
    if (code === 'USER_NOT_FOUND') return t('e_gift_notfound');
    if (code === 'BOX_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return t('e_market_locked');
    return t('error');
  };

  const sendGift = async () => {
    if (!giftValid || gBusy) return;
    setGBusy(true);
    try {
      const body: Record<string, unknown> = gAll ? { all: true } : { username: gUser.trim() };
      if (coinsN > 0) body.coins = coinsN;
      if (xpN > 0) body.xp = xpN;
      if (gItem) body.itemCode = gItem;
      if (gBox) body.boxCode = gBox;
      if (gNote.trim()) body.note = gNote.trim();
      const r = await api.post<GiftResp>('/api/admin/gift', body);
      toast.success(
        gAll
          ? `${t('gift_sent')} — ${fmt(r.count)} بازیکن · players`
          : t('gift_sent'),
      );
      setGUser(''); setGCoins(''); setGXp(''); setGItem(''); setGBox(''); setGNote('');
    } catch (e) {
      toast.error(giftErrMsg(e));
    } finally {
      setGBusy(false);
    }
  };

  /* — cheat engine — */
  const [cTarget, setCTarget] = useState('');
  const [cLevel, setCLevel] = useState('');
  const [cRating, setCRating] = useState('');
  const [cCoins, setCCoins] = useState('');
  const [cUnlock, setCUnlock] = useState(false);
  const [cUnban, setCUnban] = useState(false);
  const [cBusy, setCBusy] = useState(false);

  const lv = cLevel ? clampInt(cLevel, 1, 99) : null;
  const rt = cRating ? clampInt(cRating, 100, 4000) : null;
  const cn = cCoins ? clampInt(cCoins, 0, 1_000_000) : null;
  const cheatValid = cTarget.trim().length >= 2 && (lv !== null || rt !== null || cn !== null || cUnlock || cUnban);

  const applyCheat = async () => {
    if (!cheatValid || cBusy) return;
    setCBusy(true);
    try {
      const body: Record<string, unknown> = { username: cTarget.trim() };
      if (lv !== null) body.setLevel = lv;
      if (rt !== null) body.setRating = rt;
      if (cn !== null) body.setCoins = cn;
      if (cUnlock) body.unlockAchievements = true;
      if (cUnban) body.clearBans = true;
      const r = await api.post<CheatResp>('/api/admin/cheat', body);
      const line = [
        `🪙 ${fmt(r.user.coins)}`,
        `✦ ${fmt(r.user.xp)}`,
        `${t('level')} ${fmt(r.user.level)}`,
        `⭐ ${fmt(r.user.rating)}`,
        r.unlocked > 0 ? `🏆 ${fmt(r.unlocked)}` : '',
      ].filter(Boolean).join(' · ');
      toast.success(`${t('cheat_applied')} — ${line}`);
    } catch {
      toast.error(t('error'));
    } finally {
      setCBusy(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* ————— Gifting center ————— */}
      <div className="royal-card rounded-2xl p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black">
          <Gift className="h-4 w-4 text-pink-400" /> {t('gift_title')}
        </h3>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] px-3 py-2">
          <span className="text-xs font-bold">{t('gift_all')}</span>
          <Switch checked={gAll} onCheckedChange={setGAll} aria-label={t('gift_all')} />
        </div>

        <div className="mt-2.5 space-y-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('gift_user')}</span>
            <Input
              value={gUser}
              onChange={(e) => setGUser(e.target.value)}
              disabled={gAll}
              maxLength={32}
              dir="ltr"
              placeholder="username"
              aria-label={t('gift_user')}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('gift_coins')}</span>
              <Input
                type="number" dir="ltr" min={0} max={1000000} inputMode="numeric"
                value={gCoins}
                onChange={(e) => setGCoins(e.target.value)}
                placeholder="0"
                aria-label={t('gift_coins')}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('gift_xp')}</span>
              <Input
                type="number" dir="ltr" min={0} max={1000000} inputMode="numeric"
                value={gXp}
                onChange={(e) => setGXp(e.target.value)}
                placeholder="0"
                aria-label={t('gift_xp')}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('gift_item')}</span>
            <Select value={gItem || 'none'} onValueChange={(v) => setGItem(v === 'none' ? '' : v)}>
              <SelectTrigger aria-label={t('gift_item')}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">— {t('gift_item')} —</SelectItem>
                {cats.map((cat) => (
                  <SelectGroup key={cat}>
                    <SelectLabel>{t(`cat_${cat}` as TKey)}</SelectLabel>
                    {items.filter((i) => i.category === cat).map((i) => (
                      <SelectItem key={i.code} value={i.code}>
                        <span dir="ltr">{i.code}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('gift_box')}</span>
            <Select value={gBox || 'none'} onValueChange={(v) => setGBox(v === 'none' ? '' : v)}>
              <SelectTrigger aria-label={t('gift_box')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— {t('gift_box')} —</SelectItem>
                {BOX_CODES.map((c) => (
                  <SelectItem key={c} value={c}>{BOX_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('gift_note')}</span>
            <Input
              value={gNote}
              onChange={(e) => setGNote(e.target.value)}
              maxLength={140}
              placeholder="…"
              aria-label={t('gift_note')}
            />
          </label>

          <Button className="w-full glow-gold" disabled={gBusy || !giftValid} onClick={() => void sendGift()}>
            <Gift className="h-4 w-4" /> {t('gift_send')}
          </Button>
        </div>
      </div>

      {/* ————— Developer cheat engine (destructive tint) ————— */}
      <div className="royal-card rounded-2xl border-rose-500/30 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black">
          <Wand2 className="h-4 w-4 text-rose-400" /> {t('cheat_title')}
        </h3>

        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('cheat_hint')}</span>
        </div>

        <div className="space-y-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('cheat_target')}</span>
            <Input
              value={cTarget}
              onChange={(e) => setCTarget(e.target.value)}
              maxLength={32}
              dir="ltr"
              placeholder="username"
              aria-label={t('cheat_target')}
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] leading-tight text-muted-foreground">سطح (۱ تا ۹۹) · Level</span>
              <Input
                type="number" dir="ltr" min={1} max={99} inputMode="numeric"
                value={cLevel}
                onChange={(e) => setCLevel(e.target.value)}
                placeholder="—"
                aria-label="set level"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] leading-tight text-muted-foreground">رنک (۱۰۰ تا ۴۰۰۰) · Rating</span>
              <Input
                type="number" dir="ltr" min={100} max={4000} inputMode="numeric"
                value={cRating}
                onChange={(e) => setCRating(e.target.value)}
                placeholder="—"
                aria-label="set rating"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] leading-tight text-muted-foreground">سکه · Coins</span>
              <Input
                type="number" dir="ltr" min={0} max={1000000} inputMode="numeric"
                value={cCoins}
                onChange={(e) => setCCoins(e.target.value)}
                placeholder="—"
                aria-label="set coins"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] px-3 py-2">
            <span className="text-xs font-bold">همهٔ دستاوردها · Unlock all achievements</span>
            <Switch checked={cUnlock} onCheckedChange={setCUnlock} aria-label="unlock all achievements" />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[.04] px-3 py-2">
            <span className="text-xs font-bold">رفع مسدودی · Clear bans</span>
            <Switch checked={cUnban} onCheckedChange={setCUnban} aria-label="clear bans" />
          </div>

          <Button variant="destructive" className="w-full" disabled={cBusy || !cheatValid} onClick={() => void applyCheat()}>
            <Wand2 className="h-4 w-4" /> {t('cheat_apply')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Chest odds -------------------------------- */
/* task 6-b: per-chest drop pool editor — weight tuning, %, add/delete drops  */

function AddDropForm({ boxCode, items, onAdded }: { boxCode: string; items: StoreItemRow[]; onAdded: () => void }) {
  const { t } = useApp();
  const [kind, setKind] = useState<'COINS' | 'XP' | 'ITEM'>('COINS');
  const [itemCode, setItemCode] = useState('');
  const [amount, setAmount] = useState('');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);

  const amountN = clampInt(amount, 0, 1_000_000);
  const weightN = clampInt(weight, 1, 1000);
  const valid = amountN !== null && weightN !== null && (kind !== 'ITEM' || !!itemCode);

  const submit = async () => {
    if (!valid || busy || amountN === null || weightN === null) return;
    setBusy(true);
    try {
      await api.post('/api/admin/boxes', {
        boxCode,
        kind,
        itemCode: kind === 'ITEM' ? itemCode : undefined,
        amount: amountN,
        weight: weightN,
      });
      toast.success(`${boxCode} — ${t('success')}`);
      setItemCode(''); setAmount(''); setWeight(''); setKind('COINS');
      onAdded();
    } catch {
      toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-amber-500/15 bg-white/[.03] p-3">
      <label className="block w-32 space-y-1">
        <span className="text-[10px] text-muted-foreground">{t('box_kind')}</span>
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger aria-label={t('box_kind')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['COINS', 'XP', 'ITEM'] as const).map((k) => (
              <SelectItem key={k} value={k}>{DROP_KIND_META[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {kind === 'ITEM' && (
        <label className="block min-w-44 flex-1 space-y-1">
          <span className="text-[10px] text-muted-foreground">{t('gift_item')}</span>
          <Select value={itemCode || 'none'} onValueChange={(v) => setItemCode(v === 'none' ? '' : v)}>
            <SelectTrigger aria-label={t('gift_item')}><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="none">— {t('gift_item')} —</SelectItem>
              {items.map((i) => (
                <SelectItem key={i.code} value={i.code}><span dir="ltr">{i.code}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      <label className="block w-24 space-y-1">
        <span className="text-[10px] text-muted-foreground">مقدار · Amount</span>
        <Input
          type="number" dir="ltr" min={0} max={1000000} inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="drop amount"
        />
      </label>

      <label className="block w-24 space-y-1">
        <span className="text-[10px] text-muted-foreground">{t('box_weight')} (۱ تا ۱۰۰۰)</span>
        <Input
          type="number" dir="ltr" min={1} max={1000} inputMode="numeric"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          aria-label="drop weight"
        />
      </label>

      <Button size="sm" className="h-9 shrink-0" disabled={busy || !valid} onClick={() => void submit()}>
        <Plus className="h-4 w-4" /> {t('box_drop_add')}
      </Button>
    </div>
  );
}

function BoxesTab() {
  const { t, locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);
  const boxes = useAdminData<BoxesDTO>('/api/admin/boxes');
  const store = useAdminData<{ items: StoreItemRow[] }>('/api/store');
  const storeItems = store.data?.items ?? [];

  const [wDrafts, setWDrafts] = useState<Record<string, string>>({});
  const [delTarget, setDelTarget] = useState<{ box: AdminBoxRow; drop: BoxDropRow } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const saveWeight = async (box: AdminBoxRow, drop: BoxDropRow) => {
    const raw = wDrafts[drop.id];
    if (raw === undefined) return;
    const n = clampInt(raw, 0, 1000);
    if (n === null || n === drop.weight) {
      setWDrafts((d) => { const c = { ...d }; delete c[drop.id]; return c; });
      return;
    }
    try {
      await api.patch('/api/admin/boxes', { dropId: drop.id, weight: n });
      boxes.patch((d) => ({
        boxes: d.boxes.map((b) => (b.code === box.code
          ? { ...b, drops: b.drops.map((x) => (x.id === drop.id ? { ...x, weight: n } : x)) }
          : b)),
      }));
      setWDrafts((d) => { const c = { ...d }; delete c[drop.id]; return c; });
      toast.success(`${box.code} — ${t('success')}`);
    } catch {
      toast.error(t('error'));
      boxes.refresh();
    }
  };

  const doDelete = async () => {
    if (!delTarget || deleting) return;
    setDeleting(true);
    try {
      await api.del(`/api/admin/boxes?id=${encodeURIComponent(delTarget.drop.id)}`);
      toast.success(t('success'));
      boxes.refresh();
      setDelTarget(null);
    } catch {
      toast.error(t('error'));
    } finally {
      setDeleting(false);
    }
  };

  const list = boxes.data?.boxes ?? [];

  return boxes.loading && !boxes.data ? <ListSkeleton rows={3} /> : (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        شانس هر جایزه = وزن ÷ جمع وزن‌های همان صندوق · Odds = weight ÷ total weight per chest
      </p>

      {list.length === 0 && <EmptyHint>صندوقی یافت نشد · No chests found</EmptyHint>}

      {list.map((b) => {
        const total = b.drops.reduce((s, d) => s + d.weight, 0);
        return (
          <div key={b.code} className="royal-card rounded-2xl p-4">
            {/* header */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <PackageOpen className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="text-sm font-black" dir="ltr">{b.code}</span>
              <Badge variant="outline" className={`text-[10px] ${RARITY_STYLE[b.rarity] ?? ''}`}>
                {t(`rarity_${b.rarity}` as TKey)}
              </Badge>
              <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[10px] font-bold text-amber-300">
                🪙 {fmt(b.price)}
              </Badge>
              {!b.active && (
                <Badge variant="outline" className="border-slate-400/40 bg-slate-500/10 text-[10px] text-slate-300">
                  غیرفعال · Off
                </Badge>
              )}
              <span className="ms-auto text-[11px] text-muted-foreground">
                بازشدن · Opens: <b className="text-foreground">{fmt(b.opens)}</b>
                {' · '}وزن کل · Σw: <b className="text-foreground">{fmt(total)}</b>
              </span>
            </div>

            {/* drops table */}
            {b.drops.length === 0 ? (
              <EmptyHint>شانسی ثبت نشده · No drops yet</EmptyHint>
            ) : (
              <div className="overflow-x-auto nice-scroll">
                <Table className="min-w-[620px]">
                  <TableHeader>
                    <TableRow className="border-amber-500/15 hover:bg-transparent">
                      <TableHead>{t('box_kind')}</TableHead>
                      <TableHead>آیتم · Item</TableHead>
                      <TableHead>مقدار · Amount</TableHead>
                      <TableHead>{t('box_weight')}</TableHead>
                      <TableHead>شانس · Odds</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.drops.map((d) => {
                      const km = DROP_KIND_META[d.kind] ?? { label: d.kind, cls: EVENT_FALLBACK_CLS };
                      const raw = wDrafts[d.id];
                      return (
                        <TableRow key={d.id} className="border-amber-500/10">
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${km.cls}`}>{km.label}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs" dir="ltr">{d.itemCode ?? '—'}</TableCell>
                          <TableCell className="font-bold">{fmt(d.amount)}</TableCell>
                          <TableCell>
                            <Input
                              dir="ltr"
                              type="number"
                              min={0}
                              max={1000}
                              inputMode="numeric"
                              className="h-8 w-20"
                              value={raw ?? String(d.weight)}
                              onChange={(e) => setWDrafts((dr) => ({ ...dr, [d.id]: e.target.value }))}
                              onBlur={() => void saveWeight(b, d)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              aria-label={`${t('box_weight')} ${b.code}`}
                            />
                          </TableCell>
                          <TableCell className="font-black text-amber-300">{fmtPct(d.weight, total, locale)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                              onClick={() => setDelTarget({ box: b, drop: d })}
                              aria-label={`remove drop ${d.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <AddDropForm boxCode={b.code} items={storeItems} onAdded={boxes.refresh} />
          </div>
        );
      })}

      {/* delete confirm */}
      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <AlertDialogContent className="royal-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="gold-text">حذف شانس · Remove drop entry</AlertDialogTitle>
            <AlertDialogDescription>
              این شانس از <b dir="ltr">{delTarget?.box.code}</b> حذف می‌شود و شانس‌های دیگر بازتوزیع می‌شوند ·
              This removes the entry and redistributes the odds.
              {delTarget && (
                <>
                  <br />
                  <span className="font-mono text-xs" dir="ltr">
                    {delTarget.drop.kind}{delTarget.drop.itemCode ? `:${delTarget.drop.itemCode}` : ''} ×{delTarget.drop.amount} (w:{delTarget.drop.weight})
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-500"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
            >
              <Trash2 className="h-4 w-4" /> {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------- Live monitor ------------------------------ */
/* task 6-b: presence pulse + economy counters + auto-refreshing event feed   */

function MonitorTab() {
  const { t, locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);
  const { data, loading, refresh } = useAdminData<MonitorDTO>('/api/admin/monitor');

  /* auto-refetch every 10s (stable refresh identity + cleanup) */
  useEffect(() => {
    const id = setInterval(() => refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!data) {
    return loading ? (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white/5" />)}
        </div>
        <ListSkeleton rows={6} />
      </div>
    ) : (
      <EmptyHint>داده‌ای یافت نشد · No data available</EmptyHint>
    );
  }

  const cards: { label: string; value: number; icon: ReactNode; pulse?: boolean }[] = [
    { label: 'آنلاین همین حالا · Online now', value: data.onlineNow, icon: <Wifi className="h-5 w-5 text-green-400" />, pulse: true },
    { label: 'بازیکنان حاضر · Presence', value: data.presence.players, icon: <Users className="h-5 w-5 text-sky-400" /> },
    { label: 'دوئل زنده · Live duels', value: data.presence.live, icon: <Swords className="h-5 w-5 text-emerald-400" /> },
    { label: 'امتیاز آرکید امروز · Arcade today', value: data.arcadeToday, icon: <Gamepad2 className="h-5 w-5 text-violet-400" /> },
    { label: 'بازشدن صندوق امروز · Chest opens', value: data.boxOpensToday, icon: <PackageOpen className="h-5 w-5 text-amber-400" /> },
    { label: 'خرید امروز · Purchases', value: data.purchasesToday, icon: <ShoppingBag className="h-5 w-5 text-sky-300" /> },
  ];

  return (
    <div className="space-y-4">
      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((s) => (
          <div key={s.label} className="royal-card flex items-center gap-3 rounded-2xl p-3.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5">{s.icon}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                {s.pulse && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                )}
                <span className="truncate">{s.label}</span>
              </div>
              <div className="text-xl font-black gold-text">{fmt(s.value)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* events feed */}
      <div className="royal-card rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Radio className="h-4 w-4 text-emerald-400" aria-hidden />
          <h3 className="text-sm font-black">{t('monitor_events')}</h3>
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-500/10 text-[10px] text-emerald-300">
            رویداد بازی امروز · Game events today: {fmt(data.gameEventsToday)}
          </Badge>
          <span className="ms-auto flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">به‌روزرسانی خودکار · auto 10s</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={refresh}
              disabled={loading}
              aria-label="refresh events"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </span>
        </div>

        {data.events.length === 0 ? (
          <EmptyHint>{t('monitor_no_events')}</EmptyHint>
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto nice-scroll pe-1">
            {data.events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-2.5 py-2 text-xs">
                <Badge variant="outline" className={`shrink-0 text-[9px] ${EVENT_STYLE[ev.type] ?? EVENT_FALLBACK_CLS}`}>
                  {eventLabel(ev.type)}
                </Badge>
                <b className="max-w-24 shrink-0 truncate">{ev.username ?? 'مهمان · guest'}</b>
                {payloadSummary(ev.payload) !== '' && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" dir="ltr" title={payloadSummary(ev.payload)}>
                    {payloadSummary(ev.payload)}
                  </span>
                )}
                <span className="ms-auto shrink-0 text-[10px] text-muted-foreground" title={fmtDateTime(ev.createdAt, locale)}>
                  {relTime(ev.createdAt, locale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Games switches ------------------------------ */
/* task 6-b: feature flags — optimistic toggles, revert + toast on failure    */

function GamesTab() {
  const { t } = useApp();
  const config = useAdminData<ConfigDTO>('/api/admin/config');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const flags = config.data?.flags ?? null;

  const rows: { key: string | null; label: string; sub: string; icon: ReactNode }[] = [
    { key: null, label: 'دوئل اندیشه · Duel of Thought', sub: 'بازی پرچم‌دار — همیشه فعال · Flagship — always on', icon: <Swords className="h-5 w-5 text-amber-400" /> },
    { key: 'game_orbit_enabled', label: 'Orbit Odyssey', sub: 'بازی آرکید · Arcade game', icon: <Orbit className="h-5 w-5 text-cyan-400" /> },
    { key: 'game_synapse_enabled', label: 'Synapse', sub: 'بازی آرکید · Arcade game', icon: <Brain className="h-5 w-5 text-fuchsia-400" /> },
    { key: 'game_stellar_enabled', label: 'Stellar Forge', sub: 'بازی آرکید · Arcade game', icon: <Star className="h-5 w-5 text-orange-400" /> },
    { key: 'market_enabled', label: 'بازار و فروشگاه · Market & Store', sub: 'خرید آیتم و صندوق · Items & chests', icon: <ShoppingBag className="h-5 w-5 text-emerald-400" /> },
  ];

  const toggle = async (key: string, value: boolean) => {
    if (!flags || busyKey) return;
    setBusyKey(key);
    config.patch((d) => ({ flags: { ...d.flags, [key]: value } }));
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      toast.success(t('success'));
    } catch {
      toast.error(t('error'));
      config.refresh();
    } finally {
      setBusyKey(null);
    }
  };

  if (!flags) {
    return config.loading ? <ListSkeleton rows={5} /> : <EmptyHint>داده‌ای یافت نشد · No data available</EmptyHint>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('games_toggle_hint')}</p>

      <div className="royal-card rounded-2xl divide-y divide-amber-500/10">
        {rows.map((r) => {
          const checked = r.key === null ? true : !!flags[r.key];
          const disabled = r.key === null || busyKey !== null;
          return (
            <div key={r.key ?? 'core-duel'} className="flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5">{r.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{r.label}</div>
                <div className="text-[11px] text-muted-foreground">{r.sub}</div>
              </div>
              {r.key === null && (
                <Badge variant="outline" className="hidden shrink-0 border-emerald-400/40 bg-emerald-500/10 text-[10px] text-emerald-300 sm:inline-flex">
                  همیشه روشن · Always on
                </Badge>
              )}
              <Switch
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => { if (r.key) void toggle(r.key, v); }}
                aria-label={r.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- root ----------------------------------- */

export function AdminView() {
  const { t, user } = useApp();

  /* lock screen for non-admins (shell also guards) */
  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="grid place-items-center px-4 py-28 text-center">
        <div className="royal-card rounded-3xl p-10">
          <Shield className="mx-auto mb-3 h-12 w-12 text-amber-400" />
          <p className="text-lg font-black gold-text">{t('admin_title')}</p>
          <p className="mt-2 text-sm text-muted-foreground">🔒 {t('admin_only')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10">
      {/* sticky sub-header */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-amber-500/15 bg-background/80 px-4 py-2.5 backdrop-blur-md md:top-[96px]">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400 glow-gold" />
          <h1 className="text-base font-black gold-text sm:text-lg">{t('admin_title')}</h1>
          <span className="ms-auto hidden items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-300 sm:flex">
            <Shield className="h-3 w-3" /> ADMIN
          </span>
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-4">
        <TabsList className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto nice-scroll sm:w-fit">
          <TabsTrigger value="overview" className="flex-none">{t('admin_overview')}</TabsTrigger>
          <TabsTrigger value="users" className="flex-none">{t('admin_users')}</TabsTrigger>
          <TabsTrigger value="market" className="flex-none">{t('admin_market')}</TabsTrigger>
          <TabsTrigger value="boxes" className="flex-none">صندوق‌ها · Chests</TabsTrigger>
          <TabsTrigger value="reports" className="flex-none">{t('admin_reports')}</TabsTrigger>
          <TabsTrigger value="content" className="flex-none">{t('admin_content')}</TabsTrigger>
          <TabsTrigger value="store" className="flex-none">{t('admin_items')}</TabsTrigger>
          <TabsTrigger value="chats" className="flex-none">{t('admin_chat')}</TabsTrigger>
          <TabsTrigger value="monitor" className="flex-none">{t('admin_monitor')}</TabsTrigger>
          <TabsTrigger value="games" className="flex-none">{t('admin_games')}</TabsTrigger>
          <TabsTrigger value="boards" className="flex-none">جدول‌ها · Boards</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="market" className="mt-4"><MarketTab /></TabsContent>
        <TabsContent value="boxes" className="mt-4"><BoxesTab /></TabsContent>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
        <TabsContent value="content" className="mt-4"><ContentTab /></TabsContent>
        <TabsContent value="store" className="mt-4"><StoreTab /></TabsContent>
        <TabsContent value="chats" className="mt-4 space-y-4"><ChatsTab /><FriendChatAdmin /></TabsContent>
        <TabsContent value="monitor" className="mt-4"><MonitorTab /></TabsContent>
        <TabsContent value="games" className="mt-4"><GamesTab /></TabsContent>
        <TabsContent value="boards" className="mt-4"><BoardsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
