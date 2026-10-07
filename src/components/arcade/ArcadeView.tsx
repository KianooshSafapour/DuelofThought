'use client';

/**
 * LibraryView — THE single unified game library (v0.3).
 * One place lists everything players can choose and play:
 *   · Duel of Thought (flagship 63-cell board)  → opens the play experience
 *   · the six science-arcade games              → mount their cores here
 * Plus the Native & Offline builds section (PWA install + platform kits).
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, Rocket, BrainCircuit, Star, Trophy, BookOpen, Swords, Crosshair, Mountain, Gamepad2, Download, MonitorSmartphone, Laptop, Smartphone, Apple, MousePointer2 } from 'lucide-react';
import { sfx } from '@/lib/sound';

const OrbitGame = dynamic(() => import('@/components/arcade/OrbitGame').then((m) => m.OrbitGame), { loading: () => <CenterSpinner /> });
const SynapseGame = dynamic(() => import('@/components/arcade/SynapseGame').then((m) => m.SynapseGame), { loading: () => <CenterSpinner /> });
const StellarGame = dynamic(() => import('@/components/arcade/StellarGame').then((m) => m.StellarGame), { loading: () => <CenterSpinner /> });
const TinkTankGame = dynamic(() => import('@/components/arcade/TinkTankGame').then((m) => m.TinkTankGame), { loading: () => <CenterSpinner /> });
const BoulderYardGame = dynamic(() => import('@/components/arcade/BoulderYardGame').then((m) => m.BoulderYardGame), { loading: () => <CenterSpinner /> });
const CheesyPursuitGame = dynamic(() => import('@/components/arcade/CheesyPursuitGame').then((m) => m.CheesyPursuitGame), { loading: () => <CenterSpinner /> });

type GameId = 'orbit' | 'synapse' | 'stellar' | 'mazemind' | 'boulderyard' | 'cheese';
type Board = { top: { rank: number; score: number; user: { username: string; avatarItem: string; level: number } }[]; myBest: { score: number } | null; myPlays: number };

interface GameMeta {
  id: GameId; icon: React.ReactNode; cover: string; nameKey: string; tagKey: string; descKey: string;
  accent: string; campaign: boolean;
}

function CenterSpinner() {
  return <div className="grid place-items-center py-32"><div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400/30 border-t-amber-400" /></div>;
}

const GAMES: GameMeta[] = [
  {
    id: 'orbit', icon: <Rocket className="h-5 w-5" />, cover: '/art/orbit-cover.jpg',
    nameKey: 'game_orbit', tagKey: 'game_orbit_tag', descKey: 'game_orbit_desc',
    accent: '#22d3ee', campaign: true,
  },
  {
    id: 'synapse', icon: <BrainCircuit className="h-5 w-5" />, cover: '/art/synapse-cover.jpg',
    nameKey: 'game_synapse', tagKey: 'game_synapse_tag', descKey: 'game_synapse_desc',
    accent: '#c084fc', campaign: true,
  },
  {
    id: 'stellar', icon: <Star className="h-5 w-5" />, cover: '/art/stellar-cover.jpg',
    nameKey: 'game_stellar', tagKey: 'game_stellar_tag', descKey: 'game_stellar_desc',
    accent: '#f59e0b', campaign: false,
  },
  {
    id: 'mazemind', icon: <Crosshair className="h-5 w-5" />, cover: '/art/mazemind-cover.jpg',
    nameKey: 'game_mazemind', tagKey: 'game_mazemind_tag', descKey: 'game_mazemind_desc',
    accent: '#f43f5e', campaign: true,
  },
  {
    id: 'boulderyard', icon: <Mountain className="h-5 w-5" />, cover: '/art/boulderyard-cover.jpg',
    nameKey: 'game_boulderyard', tagKey: 'game_boulderyard_tag', descKey: 'game_boulderyard_desc',
    accent: '#34d399', campaign: true,
  },
  {
    id: 'cheese', icon: <MousePointer2 className="h-5 w-5" />, cover: '/art/cheese-cover.jpg',
    nameKey: 'game_cheese', tagKey: 'game_cheese_tag', descKey: 'game_cheese_desc',
    accent: '#fbbf24', campaign: true,
  },
];

type ReleaseFile = { file: string; platform: string; label: string; size: number };
type ReleaseManifest = { version: string; files: ReleaseFile[] };

function detectPlatform(): 'windows' | 'linux' | 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

export function ArcadeView() {
  const { t, locale, user, setView } = useApp();
  const [active, setActive] = useState<GameId | null>(null);
  const [enabled, setEnabled] = useState<Record<GameId, boolean>>({ orbit: true, synapse: true, stellar: true, mazemind: true, boulderyard: true, cheese: true });
  const [boards, setBoards] = useState<Partial<Record<GameId, Board>>>({});
  const [releases, setReleases] = useState<ReleaseManifest | null>(null);
  const [installEvt, setInstallEvt] = useState<{ prompt: () => void } | null>(null);
  const [platform, setPlatform] = useState<'windows' | 'linux' | 'android' | 'ios' | 'other'>('other');

  /* which games are on? */
  useEffect(() => {
    api.get<{ games: Record<GameId, boolean> }>('/api/config').then((c) => setEnabled(c.games)).catch(() => undefined);
    api.get<ReleaseManifest>('/api/releases').then((r) => setReleases(r)).catch(() => undefined);
    Promise.resolve().then(() => setPlatform(detectPlatform()));
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as unknown as { prompt: () => void }); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  /* load per-game leaderboards */
  useEffect(() => {
    let live = true;
    for (const g of GAMES) {
      api.get<Board>(`/api/arcade?game=${g.id}`).then((b) => { if (live) setBoards((prev) => ({ ...prev, [g.id]: b })); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, []);

  if (active === 'orbit') return <OrbitGame onExit={() => { setActive(null); sfx.click(); }} />;
  if (active === 'synapse') return <SynapseGame onExit={() => { setActive(null); sfx.click(); }} />;
  if (active === 'stellar') return <StellarGame onExit={() => { setActive(null); sfx.click(); }} />;
  if (active === 'mazemind') return <TinkTankGame onExit={() => { setActive(null); sfx.click(); }} />;
  if (active === 'boulderyard') return <BoulderYardGame onExit={() => { setActive(null); sfx.click(); }} />;
  if (active === 'cheese') return <CheesyPursuitGame onExit={() => { setActive(null); sfx.click(); }} />;

  const doInstall = async () => {
    if (installEvt) {
      installEvt.prompt();
      setInstallEvt(null);
      sfx.achievement();
      return;
    }
    // fallback: guide toast
    sfx.click();
  };

  const PLAT_ICON: Record<string, React.ReactNode> = {
    windows: <MonitorSmartphone className="h-4 w-4" />,
    linux: <Laptop className="h-4 w-4" />,
    android: <Smartphone className="h-4 w-4" />,
    ios: <Apple className="h-4 w-4" />,
    other: <Download className="h-4 w-4" />,
  };

  return (
    <div className="mx-auto max-w-6xl px-3 py-6">
      {/* hero */}
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-amber-500/20" dir="ltr">
        <Image src="/art/duel-hero.jpg" alt="" width={1440} height={720} className="h-36 w-full object-cover sm:h-52" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-start justify-end gap-1 p-4 sm:p-6" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
          <h1 className="text-2xl font-black gold-text sm:text-3xl">{t('lib_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('lib_sub')}</p>
        </div>
      </section>

      {/* ── flagship: Duel of Thought ── */}
      <section className="mb-6">
        <Card
          className="royal-card group cursor-pointer overflow-hidden border-amber-500/40 transition-transform hover:-translate-y-1"
          onClick={() => { setView('play'); sfx.click(); }}
          role="button"
          aria-label={t('appName')}
        >
          <div className="flex flex-col sm:flex-row" dir="ltr">
            <div className="relative h-40 w-full shrink-0 overflow-hidden sm:h-auto sm:w-64">
              <Image src="/art/duel-cover.jpg" alt="" width={640} height={640} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent sm:bg-gradient-to-r" />
              <Badge className="absolute start-2 top-2 border-0 bg-amber-500/90 text-[10px] font-black text-black">👑 {t('lib_duel_tag')}</Badge>
            </div>
            <CardContent className="flex flex-1 flex-col justify-center gap-2 p-4 sm:p-6">
              <div className="flex items-center justify-between" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
                <h3 className="flex items-center gap-2 text-xl font-black text-amber-400"><Gamepad2 className="h-6 w-6" /> {t('appName')}</h3>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>{t('rules_full')}</p>
              <div dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
                <Button size="sm" className="glow-gold w-fit">{t('lib_play_now')} ▶</Button>
              </div>
            </CardContent>
          </div>
        </Card>
      </section>

      {/* arcade game cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('lib_title')}>
        {GAMES.map((g) => {
          const on = enabled[g.id];
          const board = boards[g.id];
          return (
            <Card key={g.id} className={`group royal-card overflow-hidden transition-transform hover:-translate-y-1 ${on ? 'cursor-pointer' : 'opacity-50'}`} onClick={() => { if (on) { setActive(g.id); sfx.click(); } }}>
              <div className="relative h-36 w-full overflow-hidden" dir="ltr">
                <Image src={g.cover} alt={t(g.nameKey as never)} width={1024} height={1024} className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${on ? '' : 'grayscale'}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <Badge className="absolute start-2 top-2 border-0 text-[10px]" style={{ background: `${g.accent}22`, color: g.accent }}>{t(g.tagKey as never)}</Badge>
                {g.campaign && <Badge className="absolute end-2 top-2 border-0 bg-amber-500/20 text-[10px] text-amber-300">📖 {t('campaign')}</Badge>}
                {!user && <Badge className="absolute bottom-2 end-2 border-0 bg-black/50 text-[10px]">{t('guest')}</Badge>}
              </div>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-lg font-black" style={{ color: g.accent }}>{g.icon} {t(g.nameKey as never)}</h3>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 rtl:rotate-180" />
                </div>
                <p className="min-h-10 text-xs leading-relaxed text-muted-foreground">{t(g.descKey as never)}</p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>🏆 {t('best_score')}: <b className="text-foreground">{board?.myBest ? localizeDigits(board.myBest.score, locale) : '—'}</b></span>
                  <span><Trophy className="inline h-3 w-3 text-amber-400" /> {board?.top[0] ? `${board.top[0].user.username} · ${localizeDigits(board.top[0].score, locale)}` : '—'}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* ── native & offline builds ── */}
      <section className="mt-6 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4">
        <h4 className="flex items-center gap-2 text-sm font-black"><Download className="h-4 w-4 text-emerald-400" /> {t('dl_title')}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t('dl_sub')}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('dl_detect')}</span>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">{PLAT_ICON[platform]} {t(`dl_${platform === 'other' ? 'ios' : platform}` as never)}</Badge>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* PWA direct install */}
          <Card className="royal-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-black">📲 {t('dl_pwa_install')}</h5>
              <Badge variant="outline" className="text-[10px]">{t('dl_guide')}</Badge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('dl_pwa_note')}</p>
            <ol className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <li>• {t('dl_step_pwa')}</li>
              {platform === 'windows' && <li>• {t('dl_step_win')}</li>}
              {platform === 'linux' && <li>• {t('dl_step_lin')}</li>}
              {platform === 'android' && <li>• {t('dl_step_and')}</li>}
            </ol>
            <Button size="sm" className="mt-3 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => void doInstall()} disabled={!installEvt}>
              {installEvt ? t('dl_pwa_install') : t('dl_pwa_installed')}
            </Button>
          </Card>

          {/* native build kits */}
          <Card className="royal-card p-4">
            <h5 className="text-sm font-black">🛠️ {t('dl_pkg')}</h5>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('dl_pkg_note')}</p>
            <ul className="mt-2 space-y-1.5">
              {(releases?.files ?? []).map((f) => (
                <li key={f.file} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 font-bold">{PLAT_ICON[f.platform]} {f.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{t('dl_size')} {localizeDigits((f.size / 1024).toFixed(0), locale)} KB</span>
                    <a
                      href={`/api/releases?file=${encodeURIComponent(f.file)}`}
                      className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-black text-white transition-colors hover:bg-emerald-500"
                      onClick={() => sfx.click()}
                    >
                      {t('dl_download')}
                    </a>
                  </span>
                </li>
              ))}
              {!releases && <li className="py-2 text-center text-xs text-muted-foreground">…</li>}
            </ul>
          </Card>
        </div>
      </section>

      {/* leaderboards + codex */}
      <section className="mt-6">
        <Tabs defaultValue="orbit" dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="w-full justify-start overflow-x-auto">
            {GAMES.map((g) => (
              <TabsTrigger key={g.id} value={g.id} className="gap-1.5 text-xs">{g.icon} {t(g.nameKey as never)}</TabsTrigger>
            ))}
          </TabsList>
          {GAMES.map((g) => (
            <TabsContent key={g.id} value={g.id}>
              <Card className="royal-card p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-black"><Trophy className="h-4 w-4 text-amber-400" /> {t('arcade_board')}</h4>
                {boards[g.id] && boards[g.id]!.top.length > 0 ? (
                  <ol className="nice-scroll max-h-64 space-y-1.5 overflow-y-auto pe-1">
                    {boards[g.id]!.top.map((row) => (
                      <li key={row.rank} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${row.user.username === user?.username ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : 'bg-muted/40'}`}>
                        <span className="w-6 text-center font-black text-muted-foreground">{localizeDigits(row.rank, locale)}</span>
                        <span className="flex-1 truncate font-bold">{row.user.username}</span>
                        <span className="font-black" style={{ color: g.accent }}>{localizeDigits(row.score, locale)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground"><Swords className="mb-1 inline h-4 w-4" /> {t('monitor_no_events')}</p>
                )}
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </section>

      {/* science codex strip */}
      <section className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <h4 className="flex items-center gap-2 text-sm font-black"><BookOpen className="h-4 w-4 text-amber-400" /> {t('about_science')}</h4>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">Kepler — Astronomia Nova 1609</span>
          <span className="rounded-full bg-muted px-2 py-1">Jaeggi et al. — PNAS 2008 (dual n-back)</span>
          <span className="rounded-full bg-muted px-2 py-1">Burbidge et al. — Rev. Mod. Phys. 1957 (nucleosynthesis)</span>
          <span className="rounded-full bg-muted px-2 py-1">Oberth — Wege zur Raumschiffahrt 1929</span>
        </div>
      </section>
    </div>
  );
}
