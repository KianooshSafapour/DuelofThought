'use client';

/**
 * immersive.ts — mobile-first "fully optimized for the game" helpers.
 *
 * When a game starts on touch devices we:
 *  1. request fullscreen on the app root (so accidental nav-taps are impossible)
 *  2. try to lock landscape for arena games (best-effort, silently ignored)
 *  3. acquire a wake lock so the screen never sleeps mid-duel
 * When the game ends we unwind everything.
 *
 * All calls are guarded — desktop browsers, iOS Safari (no Fullscreen API on
 * arbitrary elements) and unsupported engines degrade to a no-op, and the
 * platform still hides its own chrome via `gameActive` in the app store.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/app';

export interface ImmersiveSession {
  release: () => Promise<void>;
}

let wakeLock: { release: () => Promise<void> } | null = null;

async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (t: string, cb: () => void) => void }> } };
    if (!nav.wakeLock) return;
    const wl = await nav.wakeLock.request('screen');
    wakeLock = wl;
    // re-acquire automatically when the tab becomes visible again
    const re = () => {
      if (document.visibilityState === 'visible') {
        nav.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', re, { once: true });
  } catch {
    /* unsupported or denied — fine */
  }
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/** Enter fullscreen on the given element (defaults to <html>). User gesture required. */
export async function enterImmersive(el?: HTMLElement | null): Promise<void> {
  try {
    const target = (el ?? document.documentElement) as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      requestFullscreen?: () => Promise<void>;
    };
    if (!document.fullscreenElement) {
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
      else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
    }
  } catch {
    /* iOS Safari & co. — ignored; chrome-hiding still applies */
  }
  await acquireWakeLock();
}

/** Best-effort landscape lock for arena games on Android/Chrome. */
export async function lockLandscape(): Promise<void> {
  try {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };
    await so?.lock?.('landscape');
  } catch {
    /* not supported — game stays responsive in portrait */
  }
}

export async function exitImmersive(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
  try {
    (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
  } catch {
    /* ignore */
  }
  try {
    await wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/**
 * Full game-session lifecycle: call from a start-button handler (the click is
 * the required user gesture). Returns a release() that unwinds everything.
 */
export async function beginGameSession(opts?: { landscape?: boolean }): Promise<ImmersiveSession> {
  if (isTouchDevice()) {
    await enterImmersive();
    if (opts?.landscape) await lockLandscape();
  }
  return { release: () => exitImmersive() };
}

/**
 * React hook — mount inside any game core. Flags the platform into
 * `gameActive` (hides nav/header/footer, freezes background effects),
 * requests fullscreen + landscape on touch devices and unwinds on unmount.
 */
export function useGameSession(landscape = false): void {
  const setGameActive = useApp((s) => s.setGameActive);
  const beganRef = useRef(false);
  useEffect(() => {
    beganRef.current = false;
    setGameActive(true);
    let released = false;
    let session: ImmersiveSession | null = null;
    const run = async () => {
      session = await beginGameSession({ landscape });
      if (released) await session.release();
    };
    if (landscape && isTouchDevice()) {
      // attempt landscape only after a real user gesture happened (pointerdown)
      const kick = () => { if (!beganRef.current) { beganRef.current = true; void run(); } window.removeEventListener('pointerdown', kick); };
      window.addEventListener('pointerdown', kick, { once: true });
    } else {
      beganRef.current = true;
      void run();
    }
    return () => {
      released = true;
      setGameActive(false);
      void exitImmersive();
    };
  }, []);
}
