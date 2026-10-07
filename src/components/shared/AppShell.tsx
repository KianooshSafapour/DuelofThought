'use client';

/**
 * AppShell — single-page app root: top bar, bottom nav (mobile), view router,
 * auth dialog, language switcher, procedural background, sticky footer, PWA.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, View } from '@/store/app';
import { api, SessionDTO } from '@/lib/api';
import { LOCALES, LOCALE_META, levelFromXpT } from '@/components/shared/shell-helpers';
import { localizeDigits } from '@/lib/i18n';
import { BackgroundCanvas, equippedBackground } from '@/components/shared/BackgroundCanvas';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { HubView } from '@/components/hub/HubView';
import { PlayView } from '@/components/game/PlayView';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { sfx, setSoundEnabled, initMusicPref, resumeMusicIfEnabled, isMusicEnabled, setMusicEnabled, setMusicMood, getMusicMood, MusicMood } from '@/lib/sound';
import { Home, Gamepad2, Store, Trophy, User, Shield, Coins, Volume2, VolumeX, Globe, LogOut, X, Music2, Music4, Moon, Sun, Drum, Rocket, Zap, ZapOff, LibraryBig, KeyRound } from 'lucide-react';

export function AppShell() {
  const { view, setView, user, authChecked, setSession, refreshSession, logout, locale, setLocale, t, patchUser, gameActive, perfMode, togglePerfMode } = useApp();
  const [authOpen, setAuthOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  /* SMS password recovery (2-step dialog, owned by T9-a) */
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [fPhone, setFPhone] = useState('');
  const [fCode, setFCode] = useState('');
  const [fPass, setFPass] = useState('');
  const [fBusy, setFBusy] = useState(false);
  const [fDevCode, setFDevCode] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0); // epoch ms when resend unlocks (60s cooldown)
  const [smsNow, setSmsNow] = useState(0);
  const [musicOn, setMusicOn] = useState(false);
  const [mood, setMood] = useState<MusicMood>('night');
  /* hidden staff access — the only way in: secret taps / hotkey (see worklog) */
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffUser, setStaffUser] = useState('');
  const [staffPass, setStaffPass] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffErr, setStaffErr] = useState<string | null>(null); // inline precise error line
  const [staffFails, setStaffFails] = useState(0); // failed attempts in this dialog session
  const [staffLock, setStaffLock] = useState(0); // epoch-ms when lockout lifts (0 = open)
  const [staffNow, setStaffNow] = useState(Date.now()); // ticker for the countdown
  const tapRef = useRef<{ n: number; at: number }>({ n: 0, at: 0 });
  const secretTap = (needed: number) => {
    const now = Date.now();
    const t = tapRef.current;
    t.n = now - t.at < 3000 ? t.n + 1 : 1;
    t.at = now;
    if (t.n >= needed) { t.n = 0; setStaffUser(''); setStaffPass(''); setStaffErr(null); setStaffFails(0); setStaffOpen(true); sfx.coin(); }
  };

  /* bootstrap session */
  useEffect(() => {
    void refreshSession();
    setMusicOn(initMusicPref());
    setMood(getMusicMood());
    // browsers block audio until a gesture — resume ambient music on first interaction
    const kick = () => { resumeMusicIfEnabled(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => { window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  }, [refreshSession]);

  const toggleMusic = useCallback(() => {
    const next = !isMusicEnabled();
    setMusicEnabled(next);
    setMusicOn(next);
  }, []);

  const pickMood = useCallback((m: MusicMood) => {
    setMood(m);
    setMusicMood(m);
    if (!isMusicEnabled()) setMusicEnabled(true); // choosing a mood turns the music on
    setMusicOn(true);
    sfx.click();
  }, []);

  const MOOD_ICON: Record<MusicMood, React.ReactNode> = {
    night: <Moon className="h-3.5 w-3.5" />,
    desert: <Sun className="h-3.5 w-3.5" />,
    battle: <Drum className="h-3.5 w-3.5" />,
  };
  const MOOD_LABEL: Record<MusicMood, string> = { night: t('mood_night'), desert: t('mood_desert'), battle: t('mood_battle') };

  /* apply locale direction */
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_META[locale].dir;
  }, [locale]);

  /* boot: reflect stored performance-mode preference on <html> */
  useEffect(() => {
    if (perfMode) document.documentElement.classList.add('perf');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* hidden staff gate hotkey: Ctrl/Cmd+Shift+A */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        setStaffUser(''); setStaffPass(''); setStaffErr(null); setStaffFails(0);
        setStaffOpen(true);
        sfx.coin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* staff-gate lockout countdown ticker (1 Hz while locked) */
  const staffLocked = staffLock > 0 && staffNow < staffLock;
  useEffect(() => {
    if (!staffOpen || !staffLocked) return;
    const id = setInterval(() => setStaffNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [staffOpen, staffLocked]);

  const doStaffLogin = async () => {
    if (staffLocked) return;
    setStaffBusy(true);
    setStaffErr(null);
    try {
      const data = await api.post<SessionDTO>('/api/auth/staff-login', { username: staffUser.trim(), password: staffPass });
      setSession(data);
      setStaffOpen(false);
      setStaffUser(''); setStaffPass(''); setStaffErr(null); setStaffFails(0);
      sfx.achievement();
      toast.success(`${t('success')} — ${data.user.username} · ADMIN`);
      useApp.getState().setView('admin');
    } catch (e) {
      sfx.bad();
      setStaffFails((n) => n + 1);
      const err = e as Error & { payload?: { error?: string; retryAfter?: number; remaining?: number } };
      const code = err.payload?.error ?? '';
      if (code === 'RATE') {
        const secs = Math.max(1, err.payload?.retryAfter ?? 60);
        setStaffLock(Date.now() + secs * 1000);
        setStaffNow(Date.now());
        setStaffErr(`LOCKOUT — RETRY IN ${secs}s`);
      } else if (code === 'BAD_CREDENTIALS') {
        const left = err.payload?.remaining;
        setStaffErr(`REJECTED — INVALID OPERATOR ID OR ACCESS KEY${typeof left === 'number' ? ` · ${left} TRIES LEFT` : ''}`);
      } else if (code === 'NOT_STAFF') {
        setStaffErr('THIS ACCOUNT IS NOT A STAFF ACCOUNT');
      } else if (code === 'BANNED') {
        setStaffErr('OPERATOR ACCOUNT SUSPENDED');
      } else {
        setStaffErr('CONNECTION FAILED — CHECK NETWORK AND RETRY');
      }
      toast.error(t('staff_denied'));
    } finally {
      setStaffBusy(false);
    }
  };

  /* 1-second ticker while the forgot dialog is open (resend cooldown countdown) */
  useEffect(() => {
    if (!forgotOpen) return;
    setSmsNow(Date.now());
    const id = setInterval(() => setSmsNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [forgotOpen]);

  /* weekly prize rollover nudge (one-shot per login session): an unclaimed
   * prize from last week's race deserves attention the moment you arrive */
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    api
      .get<{ lastWeek?: { myClaim?: { reward: number } | null; claimed: boolean } }>('/api/leaderboard/weekly')
      .then((d) => {
        if (!live || !d?.lastWeek?.myClaim || d.lastWeek.claimed) return;
        toast(t('week_prize_nudge'), {
          description: `🏆 ${t('week_claim')} +${localizeDigits(d.lastWeek.myClaim.reward, locale)} 🪙`,
          action: { label: t('nav_board'), onClick: () => useApp.getState().setView('leaderboard') },
          duration: 10_000,
        });
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [userId, locale, t]);

  /* PWA service worker (production only — dev caching breaks HMR) */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const bg = equippedBackground(user?.background ?? 'bg_royal_velvet');
  const lvl = user ? levelFromXpT(user.xp) : null;
  const coinsShown = useCountUp(user?.coins ?? 0);

  const doAuth = async (mode: 'login' | 'register' | 'guest') => {
    setBusy(true);
    try {
      let data: SessionDTO;
      if (mode === 'guest') {
        data = await api.post<SessionDTO>('/api/auth/guest');
      } else {
        data = await api.post<SessionDTO>(`/api/auth/${mode}`, { username: username.trim(), password, locale });
      }
      setSession(data);
      setAuthOpen(false);
      setUsername(''); setPassword('');
      sfx.achievement();
      toast.success(`${t('success')} — ${data.user.username}`);
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'TAKEN') toast.error(t('e_username_taken'));
      else if (code === 'BAD_CREDENTIALS') toast.error(t('e_login_failed'));
      else if (code === 'BANNED') toast.error(t('e_banned'));
      else if (code === 'INVALID_USERNAME') toast.error(t('auth_rules_user'));
      else toast.error(t('error'));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- SMS password recovery ---------- */
  const mapSmsError = (code: string) => {
    if (code === 'PHONE_BAD') toast.error(t('e_sms_phone_bad'));
    else if (code === 'CODE_INVALID' || code === 'CODE_EXPIRED') toast.error(t('e_sms_code'));
    else if (code === 'RATE') toast.error(t('e_sms_rate'));
    else if (code === 'PHONE_TAKEN') toast.error(t('e_sms_phone_taken'));
    else toast.error(t('error'));
  };

  const openForgot = () => {
    setForgotStep(1);
    setFPhone('');
    setFCode('');
    setFPass('');
    setFDevCode(null);
    setResendAt(0);
    setForgotOpen(true);
    sfx.click();
  };

  const requestSmsCode = async () => {
    setFBusy(true);
    try {
      const res = await api.post<{ ok: boolean; devCode?: string }>('/api/auth/forgot', { phone: fPhone.trim() });
      setFDevCode(res.devCode ?? null);
      setForgotStep(2);
      setResendAt(Date.now() + 60_000);
      toast.success(t('sms_code_sent'));
    } catch (e) {
      mapSmsError((e as Error).message);
    } finally {
      setFBusy(false);
    }
  };

  const doSmsReset = async () => {
    setFBusy(true);
    try {
      await api.post('/api/auth/reset', { phone: fPhone.trim(), code: fCode.trim(), newPassword: fPass });
      sfx.achievement();
      toast.success(t('sms_reset_ok'));
      setForgotOpen(false);
    } catch (e) {
      mapSmsError((e as Error).message);
    } finally {
      setFBusy(false);
    }
  };

  const resendIn = Math.max(0, Math.ceil((resendAt - smsNow) / 1000));

  const nav: { v: View; icon: React.ReactNode; label: string; adminOnly?: boolean }[] = [
    { v: 'hub', icon: <Home className="h-5 w-5" />, label: t('nav_hub') },
    { v: 'arcade', icon: <LibraryBig className="h-5 w-5" />, label: t('nav_library') },
    { v: 'store', icon: <Store className="h-5 w-5" />, label: t('nav_store') },
    { v: 'leaderboard', icon: <Trophy className="h-5 w-5" />, label: t('nav_board') },
    { v: 'profile', icon: <User className="h-5 w-5" />, label: t('nav_profile') },
    ...(user?.role === 'ADMIN' ? [{ v: 'admin' as View, icon: <Shield className="h-5 w-5" />, label: t('nav_admin'), adminOnly: true }] : []),
  ];

  const toggleSound = () => {
    const v = !(user?.soundOn ?? true);
    patchUser({ soundOn: v });
    setSoundEnabled(v);
    api.patch('/api/profile', { soundOn: v }).catch(() => undefined);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <BackgroundCanvas kind={bg.kind} colors={bg.colors} accent={bg.accent} />

      {/* ---------- top bar (hidden while a game owns the screen) ---------- */}
      <header className={`sticky top-0 z-40 border-b border-amber-500/15 bg-background/80 backdrop-blur-md ${gameActive ? 'hidden' : ''}`}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-1 px-2 sm:gap-2 sm:px-3">
          <button className="flex items-center gap-2" onClick={() => { secretTap(7); setView('hub'); sfx.click(); }} aria-label="home">
            <img src="/brand/logo.png" className="h-9 w-9 rounded-xl object-cover shadow-lg ring-1 ring-amber-500/40" alt="" />
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-black gold-text">{t('appName')}</span>
              <span className="text-[9px] text-muted-foreground">{t('parkName')}</span>
            </span>
          </button>

          <div className="flex items-center gap-1.5">
            {/* coins & level */}
            {user && (
              <>
                <div className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-black text-amber-400" title={t('coins')}>
                  <Coins className="h-3.5 w-3.5" /> {localizeDigits(coinsShown, locale)}
                </div>
                <div className="hidden items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-400 sm:flex">
                  ⭐ {t('level')} {localizeDigits(user.level, locale)}
                </div>
              </>
            )}
            {/* sound */}
            <button className="rounded-lg p-2 hover:bg-muted" onClick={toggleSound} aria-label="sound">
              {(user?.soundOn ?? true) ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            {/* performance mode: pause decorative effects to save CPU/battery */}
            <button
              className={`rounded-lg p-2 hover:bg-muted ${perfMode ? 'text-emerald-400' : 'text-muted-foreground'}`}
              onClick={() => { togglePerfMode(); sfx.click(); }}
              aria-label="performance mode"
              title={perfMode ? t('perf_on') : t('perf_off')}
            >
              {perfMode ? <ZapOff className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            </button>
            {/* ambient music: quick toggle + mood picker */}
            <div className="flex items-center">
              <button className={`relative rounded-lg p-2 hover:bg-muted ${musicOn ? 'text-amber-400' : 'text-muted-foreground'}`} onClick={toggleMusic} aria-label="music" title={t('music')}>
                {musicOn ? <Music4 className="h-4 w-4 animate-pulse" /> : <Music2 className="h-4 w-4" />}
                {musicOn && <span className="absolute end-1 top-1 h-1 w-1 animate-ping rounded-full bg-amber-400" />}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`hidden rounded-lg px-1 py-2 text-[9px] font-bold hover:bg-muted sm:block ${musicOn ? 'text-amber-400' : 'text-muted-foreground'}`} aria-label="music mood" title={t('music_mood')}>
                    {MOOD_ICON[mood]}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t('music_mood')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(['night', 'desert', 'battle'] as MusicMood[]).map((m) => (
                    <DropdownMenuItem key={m} onClick={() => pickMood(m)} className={mood === m && musicOn ? 'bg-amber-400/15 text-amber-400' : ''}>
                      {MOOD_ICON[m]} {MOOD_LABEL[m]}
                      {mood === m && musicOn && <span className="ms-auto text-[10px]">✓</span>}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={toggleMusic} className="text-muted-foreground">
                    <Music2 className="h-3.5 w-3.5" /> {musicOn ? t('music_off') : t('music')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* language */}
            <div className="relative">
              <select
                className="appearance-none rounded-lg bg-muted py-2 pe-2 ps-2 text-xs font-bold outline-none"
                value={locale}
                onChange={(e) => { setLocale(e.target.value as typeof locale); sfx.click(); }}
                aria-label="language"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>{LOCALE_META[l].flag} {LOCALE_META[l].label}</option>
                ))}
              </select>
            </div>
            {/* account */}
            {authChecked && (user ? (
              <button
                className="flex items-center gap-1.5 rounded-full border border-amber-500/30 p-0.5 pe-2 hover:bg-muted"
                onClick={() => { setView('profile'); sfx.click(); }}
                aria-label="profile"
              >
                <AvatarBubble code={user.avatarItem} size={26} />
                <span className="max-w-20 truncate text-xs font-bold">{user.username}</span>
              </button>
            ) : (
              <Button size="sm" className="glow-gold" onClick={() => { setAuthOpen(true); sfx.click(); }}>
                {t('login')}
              </Button>
            ))}
          </div>
        </div>
      </header>

      {/* ---------- desktop nav ---------- */}
      <nav className={`sticky top-14 z-30 hidden border-b border-amber-500/10 bg-background/60 backdrop-blur md:block ${gameActive ? '!hidden' : ''}`} aria-label="main">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-3 py-1.5">
          {nav.map((n) => (
            <button
              key={n.v}
              onClick={() => { setView(n.v); sfx.click(); }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
                view === n.v ? 'bg-amber-400/15 text-amber-400' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {n.icon} {n.label}
            </button>
          ))}
          {user && (
            <button className="ms-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-rose-400" onClick={() => void logout()}>
              <LogOut className="h-3.5 w-3.5" /> {t('logout')}
            </button>
          )}
        </div>
      </nav>

      {/* ---------- main ---------- */}
      <main className={`flex-1 ${gameActive ? 'pb-0' : 'pb-20 md:pb-4'}`} dir={LOCALE_META[locale].dir}>
        {!authChecked ? (
          <div className="grid place-items-center py-32"><div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400/30 border-t-amber-400" /></div>
        ) : (
          <>
            {view === 'hub' && <HubView />}
            {view === 'arcade' && <ArcadeLazy />}
            {view === 'play' && <PlayView />}
            {view === 'store' && <StoreLazy />}
            {view === 'leaderboard' && <LeaderboardLazy />}
            {view === 'profile' && <ProfileLazy />}
            {view === 'admin' && (user?.role === 'ADMIN' ? <AdminLazy /> : <div className="py-32 text-center text-muted-foreground">🔒 {t('admin_only')}</div>)}
          </>
        )}
      </main>

      {/* ---------- sticky footer ---------- */}
      <footer className={`mt-auto border-t border-amber-500/15 bg-background/80 pb-safe backdrop-blur-md ${gameActive ? 'hidden' : ''}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-muted-foreground">
          <span>© {localizeDigits(new Date().getFullYear(), locale)} {t('company')} — {t('made_with')}</span>
          <div className="flex items-center gap-3">
            <button className="underline-offset-2 transition-colors hover:text-amber-400 hover:underline" onClick={() => { setRulesOpen(true); sfx.click(); }}>{t('footer_rules')}</button>
            <button className="underline-offset-2 transition-colors hover:text-amber-400 hover:underline" onClick={() => { setAboutOpen(true); sfx.click(); }}>{t('footer_about')}</button>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> fa · en · ar · tr</span>
            <button
              className="hidden items-center gap-1 sm:inline-flex select-none"
              onClick={() => secretTap(5)}
              title={t('version')}
            >
              {t('version')} v0.4.0-alpha
            </button>
          </div>
        </div>
      </footer>

      {/* ---------- mobile bottom nav ---------- */}
      <nav className={`fixed inset-x-0 bottom-0 z-40 border-t border-amber-500/20 bg-background/90 pb-safe backdrop-blur-md md:hidden ${gameActive ? 'hidden' : ''}`} aria-label="mobile">
        <div className="flex items-stretch justify-around">
          {nav.filter((n) => !n.adminOnly).map((n) => (
            <button
              key={n.v}
              onClick={() => { setView(n.v); sfx.click(); }}
              className={`flex min-w-11 flex-1 flex-col items-center gap-0.5 py-2 text-[9px] font-bold ${view === n.v ? 'text-amber-400' : 'text-muted-foreground'}`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ---------- rules dialog ---------- */}
      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="royal-card nice-scroll max-h-[85dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined} dir={LOCALE_META[locale].dir}>
          <DialogHeader>
            <DialogTitle className="gold-text">📜 {t('rules')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-foreground/90">{t('rules_full')}</p>
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-relaxed">💡 {t('rules_tip')}</p>
          <p className="text-[11px] text-muted-foreground">⌨️ 1–9 = {t('nav_play')} (column drop)</p>
        </DialogContent>
      </Dialog>

      {/* ---------- about dialog: company, mission, team, science ---------- */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="royal-card nice-scroll max-h-[85dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined} dir={LOCALE_META[locale].dir}>
          <DialogHeader>
            <DialogTitle className="gold-text">🎓 {t('about_title')}</DialogTitle>
          </DialogHeader>

          {/* brand block */}
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <img src="/brand/logo.png" alt={t('company')} className="h-9 w-9 rounded-xl object-cover shadow-lg ring-1 ring-amber-500/40" />
            <img src="/brand/logo.png" alt={t('company')} className="h-14 w-14 rounded-xl object-cover shadow-lg" />
            <div className="leading-tight">
              <div className="text-sm font-black gold-text">{t('company')}</div>
              <div className="text-[11px] text-muted-foreground" dir="ltr">{t('company_en')}</div>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-foreground/90">{t('about_text')}</p>

          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <h4 className="mb-1 text-xs font-black text-emerald-400">🕊️ {t('about_mission')}</h4>
            <p className="text-xs leading-relaxed text-foreground/85">{t('about_mission_text')}</p>
          </div>

          {/* team */}
          <div>
            <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">{t('about_team')}</h4>
            <ul className="space-y-1.5">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((i) => (
                <li key={i} className="rounded-lg bg-muted/40 px-3 py-1.5">
                  <span className="text-xs font-black">{t(`team${i}_name` as never)}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{t(`team${i}_role` as never)}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">🔬 {t('hub_research')}</p>
          <div className="flex flex-wrap gap-2 pb-1 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-1">Martinez et al. 2023</span>
            <span className="rounded-full bg-muted px-2 py-1">Trends Neurosci. Educ. 2021</span>
            <span className="rounded-full bg-muted px-2 py-1">SDT — Deci &amp; Ryan</span>
            <span className="rounded-full bg-muted px-2 py-1">Flow — Csikszentmihalyi</span>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- auth dialog ---------- */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="royal-card sm:max-w-sm" aria-describedby={undefined} dir={LOCALE_META[locale].dir}>
          <DialogHeader>
            <DialogTitle className="text-center gold-text">{t('auth_welcome')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(['login', 'register'] as const).map((tab) => (
              <button
                key={tab}
                className={`rounded-lg py-1.5 text-sm font-bold ${authTab === tab ? 'bg-amber-400/20 text-amber-400' : 'text-muted-foreground'}`}
                onClick={() => setAuthTab(tab)}
              >
                {t(tab)}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <Input dir="ltr" placeholder={t('username')} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={16} autoComplete="username" />
            <Input dir="ltr" type="password" placeholder={t('password')} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete={authTab === 'login' ? 'current-password' : 'new-password'} />
            <button type="button" className="w-fit text-[11px] text-muted-foreground transition-colors hover:text-amber-400" onClick={openForgot}>
              {t('sms_forgot_link')}
            </button>
            <div className="text-[10px] text-muted-foreground">{t('auth_rules_user')} · {t('auth_rules_pass')}</div>
            <Button className="w-full glow-gold" disabled={busy || username.trim().length < 3 || password.length < 6} onClick={() => void doAuth(authTab)}>
              {busy ? '…' : t(authTab === 'login' ? 'login' : 'register')}
            </Button>
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void doAuth('guest')}>
              {t('auth_guest')}
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">{t('auth_guest_hint')}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- SMS forgot-password dialog (T9-a) ---------- */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="royal-card sm:max-w-sm" aria-describedby={undefined} dir={LOCALE_META[locale].dir}>
          <DialogHeader>
            <DialogTitle className="gold-text">📱 {t('sms_forgot_title')}</DialogTitle>
          </DialogHeader>
          {forgotStep === 1 ? (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-muted-foreground">{t('sms_forgot_desc')}</p>
              <Input
                dir="ltr"
                inputMode="tel"
                placeholder={`${t('sms_phone')} · ${t('sms_phone_hint')}`}
                value={fPhone}
                onChange={(e) => setFPhone(e.target.value)}
                maxLength={24}
                autoComplete="tel"
              />
              <Button className="w-full glow-gold" disabled={fBusy || fPhone.trim().length < 7} onClick={() => void requestSmsCode()}>
                {fBusy ? '…' : t('sms_send_code')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {fDevCode && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                  <div className="text-[10px] leading-relaxed text-amber-300/90">{t('sms_dev_code_note')}</div>
                  <div dir="ltr" className="mt-1 font-mono text-2xl font-black tracking-[0.35em] text-amber-400">{fDevCode}</div>
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">{t('sms_code_sent')}</p>
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder={t('sms_code')}
                value={fCode}
                onChange={(e) => setFCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                autoComplete="one-time-code"
              />
              <Input
                dir="ltr"
                type="password"
                placeholder={t('sms_new_pass')}
                value={fPass}
                onChange={(e) => setFPass(e.target.value)}
                maxLength={72}
                autoComplete="new-password"
              />
              <Button className="w-full glow-gold" disabled={fBusy || fCode.length !== 6 || fPass.length < 6} onClick={() => void doSmsReset()}>
                {fBusy ? '…' : t('sms_reset_btn')}
              </Button>
              <Button variant="ghost" className="w-full text-xs text-muted-foreground" disabled={fBusy || resendIn > 0} onClick={() => void requestSmsCode()}>
                {resendIn > 0 ? `${t('sms_resend')} · ${localizeDigits(resendIn, locale)}` : t('sms_resend')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- hidden staff gate (RESTRICTED) ---------- */}
      <Dialog open={staffOpen} onOpenChange={setStaffOpen}>
        <DialogContent className="max-w-sm border-zinc-800 bg-zinc-950 font-mono text-zinc-300 sm:max-w-sm" dir="ltr" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-xs tracking-[0.3em] text-zinc-400">
              <KeyRound className="h-3.5 w-3.5" /> RESTRICTED ACCESS
            </DialogTitle>
          </DialogHeader>
          <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
            AUTHORIZED PERSONNEL ONLY · ALL ATTEMPTS ARE LOGGED
          </p>
          <div className="space-y-2.5">
            <Input
              value={staffUser}
              onChange={(e) => setStaffUser(e.target.value)}
              placeholder="OPERATOR ID"
              className="border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
              autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              dir="ltr"
            />
            <Input
              type="password"
              value={staffPass}
              onChange={(e) => setStaffPass(e.target.value)}
              placeholder="ACCESS KEY"
              className="border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
              autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              dir="ltr"
              onKeyDown={(e) => { if (e.key === 'Enter' && !staffBusy && staffUser && staffPass && !staffLocked) void doStaffLogin(); }}
            />
            {/* precise inline status — never a generic denial */}
            {staffErr && (
              <div
                role="alert"
                className={`rounded border px-2 py-1.5 font-mono text-[10px] leading-relaxed ${
                  staffLocked
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                }`}
              >
                {staffLocked
                  ? `LOCKOUT — RETRY IN ${Math.max(1, Math.ceil((staffLock - staffNow) / 1000))}s`
                  : staffErr}
              </div>
            )}
            <Button
              className="w-full bg-zinc-800 font-mono text-xs tracking-widest text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              disabled={staffBusy || !staffUser || !staffPass || staffLocked}
              onClick={() => void doStaffLogin()}
            >
              {staffBusy ? '…' : staffLocked ? `LOCKED · ${Math.max(1, Math.ceil((staffLock - staffNow) / 1000))}s` : 'AUTHENTICATE'}
            </Button>
            {/* operator recovery — appears after 2 failures so staff is never fully locked out */}
            {staffFails >= 2 && (
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-zinc-500">
                <div className="text-zinc-400">OPERATOR RECOVERY:</div>
                <div>1) on the server run <span className="text-emerald-400">bun run admin:reset</span></div>
                <div>2) operator IDs: <span className="text-zinc-300">admin</span> · <span className="text-zinc-300">administrator</span> · <span className="text-zinc-300">demo</span></div>
                <div>3) keys are case-sensitive — check layout &amp; caps-lock</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* lazy-loaded meta views (built by platform sub-agents) */
import dynamic from 'next/dynamic';
const ArcadeLazy = dynamic(() => import('@/components/arcade/ArcadeView').then((m) => m.ArcadeView), {
  loading: () => <CenterSpinner />,
});
const StoreLazy = dynamic(() => import('@/components/store/StoreView').then((m) => m.StoreView), {
  loading: () => <CenterSpinner />,
});
const LeaderboardLazy = dynamic(() => import('@/components/leaderboard/LeaderboardView').then((m) => m.LeaderboardView), {
  loading: () => <CenterSpinner />,
});
const ProfileLazy = dynamic(() => import('@/components/profile/ProfileView').then((m) => m.ProfileView), {
  loading: () => <CenterSpinner />,
});
const AdminLazy = dynamic(() => import('@/components/admin/AdminView').then((m) => m.AdminView), {
  loading: () => <CenterSpinner />,
});

function CenterSpinner() {
  return <div className="grid place-items-center py-32"><div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400/30 border-t-amber-400" /></div>;
}

/** Smoothly tweens the header coin balance whenever it changes (count-up/down). */
function useCountUp(value: number, duration = 650): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (value - from) * eased);
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}
