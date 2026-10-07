'use client';

/**
 * Shared arcade client plumbing: score submission to the shared economy +
 * a royal result modal used by every arcade game (consistent UX).
 */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/store/app';
import { localizeDigits } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { sfx } from '@/lib/sound';
import { CelebrationSprite } from '@/components/shared/CelebrationSprite';

export interface ArcadeSubmitResult {
  ok: boolean;
  coins: number;
  xp: number;
  levelUps: number;
  completedQuests: { id: string; reward: number }[];
  unlockedAchievements: { id: string; coins: number; rarity: string }[];
  user: { coins: number; xp: number; level: number };
  clamped?: boolean;
}

export type ArcadeMeta = Record<string, string | number | boolean>;

export type ArcadeGameId = 'orbit' | 'synapse' | 'stellar' | 'mazemind' | 'boulderyard' | 'boulderyard2' | 'cheese';

/** Submit a finished run; syncs the zustand session; returns null on failure. */
export async function submitArcade(game: ArcadeGameId, score: number, meta: ArcadeMeta): Promise<ArcadeSubmitResult | null> {
  try {
    const r = await api.post<ArcadeSubmitResult>('/api/arcade', { game, score: Math.max(0, Math.floor(score)), meta });
    const { patchUser } = useApp.getState();
    patchUser({ coins: r.user.coins, xp: r.user.xp, level: r.user.level });
    return r;
  } catch (e) {
    const code = (e as Error).message;
    const { t } = useApp.getState();
    if (code === 'RATE') toast.error(t('e_rate'));
    else toast.error(t('error'));
    return null;
  }
}

/** Fire the standard reward toasts (achievements / quests / level ups). */
export function announceArcadeRewards(r: ArcadeSubmitResult) {
  const { t, locale } = useApp.getState();
  for (const a of r.unlockedAchievements) {
    sfx.achievement();
    toast.success(`🏆 ${t('ach_unlocked')}`, { description: `${t('ach_' + a.id as never) || a.id} +${localizeDigits(a.coins, locale)} 🪙`, duration: 6000 });
  }
  for (const q of r.completedQuests) {
    toast.success(`📜 ${t('quest_done')}`, { description: `+${localizeDigits(q.reward, locale)} 🪙` });
  }
  if (r.levelUps > 0) {
    sfx.achievement();
    toast.success(`⭐ ${t('level_up')} ${localizeDigits(r.user.level, locale)}`);
  }
}

export interface ResultModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  score: number;
  rewards: ArcadeSubmitResult | null;
  emoji?: string;
  /** optional override for the dancing celebration pack (falls back to the
   *  session's equipped pack, then the free celeb_confetti default) */
  celebrationCode?: string;
  onAgain: () => void;
  onExit: () => void;
}

/** Standard end-of-run modal shared by all arcade games. */
export function ArcadeResultModal({ open, title, subtitle, score, rewards, emoji = '🎮', celebrationCode, onAgain, onExit }: ResultModalProps) {
  const { t, locale, user, perfMode } = useApp.getState();
  const celebration = celebrationCode ?? user?.celebrationPack ?? 'celeb_confetti';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onExit(); }}>
      <DialogContent className="royal-card sm:max-w-sm" aria-describedby={undefined} dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="text-center gold-text">
            <span className="me-1 inline-block animate-pop text-3xl">{emoji}</span> {title}
          </DialogTitle>
        </DialogHeader>
        {subtitle && <p className="text-center text-sm text-muted-foreground">{subtitle}</p>}
        <div className="flex justify-center py-1">
          <CelebrationSprite code={celebration} dancing={!perfMode} size={88} />
        </div>
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('score')}</div>
            <div className="text-2xl font-black gold-text">{localizeDigits(score, locale)}</div>
          </div>
          {rewards && (
            <div className="flex gap-3 text-sm font-bold">
              <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-400">+{localizeDigits(rewards.coins, locale)} 🪙</span>
              <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-400">+{localizeDigits(rewards.xp, locale)} ✦</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button className="flex-1 glow-gold" onClick={() => { sfx.click(); onAgain(); }}>{t('arcade_again')}</Button>
          <Button variant="outline" className="flex-1" onClick={() => { sfx.click(); onExit(); }}>{t('back_park')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny shared hook: games call finish(score, meta) once a run ends. */
export function useArcadeFinish(game: ArcadeGameId) {
  const [rewards, setRewards] = useState<ArcadeSubmitResult | null>(null);
  const [lastScore, setLastScore] = useState(0);
  const [open, setOpen] = useState(false);

  const finish = async (score: number, meta: ArcadeMeta) => {
    setLastScore(score);
    const r = await submitArcade(game, score, meta);
    if (r) {
      setRewards(r);
      announceArcadeRewards(r);
    }
    setOpen(true);
  };

  return { finish, rewards, lastScore, open, close: () => setOpen(false) };
}
