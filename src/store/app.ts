'use client';

import { create } from 'zustand';
import { SafeUserDTO, SessionDTO, api } from '@/lib/api';
import { Locale, DICTIONARIES, TKey } from '@/lib/i18n';
import { setSoundEnabled } from '@/lib/sound';

export type View = 'hub' | 'arcade' | 'play' | 'store' | 'leaderboard' | 'profile' | 'admin';

interface AppState {
  view: View;
  setView: (v: View) => void;

  user: SafeUserDTO | null;
  owned: string[];
  authChecked: boolean;
  setSession: (s: SessionDTO | null) => void;
  patchUser: (p: Partial<SafeUserDTO>) => void;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;

  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (k: TKey) => string;

  gameSettings: { mode: 'ai' | 'local' | 'online'; aiLevel: 'EASY' | 'MEDIUM' | 'HARD'; boardId: string };
  setGameSettings: (s: Partial<AppState['gameSettings']>) => void;

  /** cross-view friend-duel handoff: set on leaderboard/profile → PlayView emits
   *  challenge:send once its lobby socket is live, then clears it */
  pendingChallenge: { userId: string; name: string } | null;
  setPendingChallenge: (c: { userId: string; name: string } | null) => void;

  /** TRUE while any game (arcade or duel) is running — platform chrome hides,
   *  background effects freeze so the whole system is optimized for the game */
  gameActive: boolean;
  setGameActive: (on: boolean) => void;
  /** user preference: disable decorative platform effects to save CPU/battery */
  perfMode: boolean;
  togglePerfMode: () => void;
}

function detectPerfMode(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem('doi_perf') === '1'; } catch { return false; }
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'fa';
  const saved = window.localStorage.getItem('doi_locale');
  if (saved && saved in DICTIONARIES) return saved as Locale;
  return 'fa'; // Persian-first by design
}

export const useApp = create<AppState>((set, get) => ({
  view: 'hub',
  setView: (v) => set({ view: v }),

  user: null,
  owned: [],
  authChecked: false,
  setSession: (s) => {
    if (s) {
      set({ user: s.user, owned: s.owned, authChecked: true });
      setSoundEnabled(s.user.soundOn);
    } else {
      set({ user: null, owned: [], authChecked: true });
    }
  },
  patchUser: (p) => {
    const u = get().user;
    if (u) set({ user: { ...u, ...p } });
  },
  refreshSession: async () => {
    try {
      const data = await api.get<SessionDTO & { banned?: boolean }>('/api/auth');
      if (data.user) set({ user: data.user, owned: data.owned, authChecked: true });
      else set({ user: null, owned: [], authChecked: true });
    } catch {
      set({ user: null, owned: [], authChecked: true });
    }
  },
  logout: async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    set({ user: null, owned: [], view: 'hub' });
  },

  locale: detectLocale(),
  setLocale: (l) => {
    set({ locale: l });
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l;
      document.documentElement.dir = l === 'fa' || l === 'ar' ? 'rtl' : 'ltr';
    }
    try { window.localStorage.setItem('doi_locale', l); } catch { /* noop */ }
    const u = get().user;
    if (u && u.locale !== l) api.patch('/api/profile', { locale: l }).catch(() => undefined);
  },
  t: (k) => DICTIONARIES[get().locale][k] ?? DICTIONARIES.fa[k],

  gameSettings: { mode: 'ai', aiLevel: 'MEDIUM', boardId: 'classic' },
  setGameSettings: (s) => set({ gameSettings: { ...get().gameSettings, ...s } }),

  pendingChallenge: null,
  setPendingChallenge: (c) => set({ pendingChallenge: c }),

  gameActive: false,
  setGameActive: (on) => {
    set({ gameActive: on });
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('gaming', on);
      document.documentElement.style.overflow = on ? 'hidden' : '';
    }
  },

  perfMode: detectPerfMode(),
  togglePerfMode: () => {
    const next = !get().perfMode;
    set({ perfMode: next });
    try { window.localStorage.setItem('doi_perf', next ? '1' : '0'); } catch { /* noop */ }
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('perf', next);
  },
}));
