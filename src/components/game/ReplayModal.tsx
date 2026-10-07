'use client';

/**
 * ReplayModal — step-through replay of a finished game.
 * Rebuilds the board from the stored move sequence with play/pause, step,
 * jump-first/last, a scrubber slider and speed control. Win cells pulse when
 * the replay reaches the final position.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GameBoard, type BoardPalette } from '@/components/game/GameBoard';
import { PieceDisc } from '@/components/shared/PixelSprite';
import { STORE_ITEMS } from '@/lib/game/content';
import { getBoard } from '@/lib/game/boards';
import { createGame, applyMove, type GameState } from '@/lib/game/engine';
import { localizeDigits } from '@/lib/i18n';
import { useApp } from '@/store/app';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Film, Pause, Play } from 'lucide-react';

interface ReplayDTO {
  id: string;
  mode: string;
  boardId: string;
  winner: string;
  endReason: string;
  p1Name: string;
  p2Name: string;
  moves: number;
  history: number[];
  partial: boolean;
  createdAt: string;
}

const SPEEDS = [
  { key: 1, label: '1×', ms: 950 },
  { key: 2, label: '2×', ms: 480 },
  { key: 4, label: '4×', ms: 240 },
] as const;

export function ReplayModal({
  gameId, onOpenChange,
}: {
  gameId: string;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, locale, user, owned } = useApp();
  const [data, setData] = useState<ReplayDTO | null>(null);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(0); // plies shown
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const loading = !data && !failed;

  /* fetch replay once on mount (modal remounts per gameId via parent) */
  useEffect(() => {
    let live = true;
    apiFetch(gameId)
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) {
          setFailed(true);
          toast.error(t('error'));
        }
      });
    return () => {
      live = false;
    };
  }, [gameId, t]);

  /* autoplay ticker — setState only inside the timeout callback */
  useEffect(() => {
    if (!playing || !data) return;
    if (cursor >= data.history.length) return;
    const ms = SPEEDS.find((s) => s.key === speed)?.ms ?? 950;
    const id = setTimeout(() => {
      const next = Math.min(cursor + 1, data.history.length);
      setCursor(next);
      if (next >= data.history.length) setPlaying(false);
      // audible tick: capture when the landed cell has a number
      const b = getBoard(data.boardId);
      if (b) {
        const st = buildState(b.numbers, data.history.slice(0, next), data.boardId);
        const cell = st.lastMove !== null ? st.cells[st.lastMove] : null;
        if (cell?.n != null) sfx.capture(); else sfx.drop();
      }
    }, ms);
    return () => clearTimeout(id);
  }, [playing, cursor, data, speed]);

  const board = useMemo(() => (data ? getBoard(data.boardId) : null), [data]);

  const state: GameState | null = useMemo(() => {
    if (!board || !data) return null;
    return buildState(board.numbers, data.history.slice(0, cursor), data.boardId);
  }, [board, data, cursor]);

  const palette = useMemo<BoardPalette>(() => {
    const code = user?.boardSkin && owned.includes(user.boardSkin) ? user.boardSkin : 'board_classic';
    return (STORE_ITEMS.find((i) => i.code === code)?.data ?? {}) as unknown as BoardPalette;
  }, [user, owned]);

  const total = data?.history.length ?? 0;
  const atEnd = total > 0 && cursor >= total;
  const lastMover = state?.lastMove !== null && state ? state.cells[state.lastMove]?.o : null;
  const lastNum = state?.lastMove !== null && state ? state.cells[state.lastMove]?.n : null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="royal-card nice-scroll max-h-[92dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
        dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-center text-xl">
            <Film className="h-5 w-5 text-amber-400" />
            <span className="gold-text">{t('replay_title')}</span>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-64 w-full max-w-[420px] rounded-xl" />
            <Skeleton className="mx-auto h-9 w-56 rounded-lg" />
          </div>
        )}

        {!loading && data && board && state && (
          <>
            {/* players line */}
            <div className="flex items-center justify-center gap-2 text-xs font-bold">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-4 w-4 overflow-hidden rounded-full align-middle">
                  <PieceDisc code="piece_terracotta" side={1} size={16} />
                </span>
                {data.p1Name}
              </span>
              <span className="text-muted-foreground">{t('replay_vs')}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-4 w-4 overflow-hidden rounded-full align-middle">
                  <PieceDisc code="piece_jade" side={2} size={16} />
                </span>
                {data.p2Name}
              </span>
            </div>

            {data.partial && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-[11px] font-bold text-amber-300">
                ⚠ {t('replay_partial')}
              </p>
            )}

            {/* board */}
            <div className="my-1">
              <GameBoard state={state} palette={palette} piece1="piece_terracotta" piece2="piece_jade" interactive={false} />
            </div>

            {/* scrubber */}
            <input
              type="range"
              min={0}
              max={total}
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
              className="w-full accent-amber-500"
              aria-label={t('replay_move')}
              dir="ltr"
            />

            {/* transport controls */}
            <div className="flex items-center justify-center gap-1.5">
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="first" disabled={cursor === 0}
                onClick={() => { setPlaying(false); setCursor(0); sfx.click(); }}>
                <ChevronFirst className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="prev" disabled={cursor === 0}
                onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)); sfx.click(); }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" className="h-11 w-11 rounded-full bg-amber-500 text-amber-950 shadow-[0_0_18px_rgba(251,191,36,0.45)] hover:bg-amber-400" aria-label={playing ? 'pause' : 'play'}
                onClick={() => { if (atEnd) setCursor(0); setPlaying((p) => !p); sfx.click(); }}>
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="next" disabled={atEnd}
                onClick={() => { setPlaying(false); setCursor((c) => Math.min(total, c + 1)); sfx.click(); }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="last" disabled={atEnd}
                onClick={() => { setPlaying(false); setCursor(total); sfx.click(); }}>
                <ChevronLast className="h-4 w-4" />
              </Button>
            </div>

            {/* status line */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden />
                <span className="font-black text-amber-400">
                  {t('replay_move')} {localizeDigits(cursor, locale)} / {localizeDigits(total, locale)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {cursor > 0 && lastMover ? (
                  <span className="font-bold">
                    {lastMover === 1 ? data.p1Name : data.p2Name}
                    {lastNum !== null && lastNum !== undefined && (
                      <span className="ms-1 text-muted-foreground">→ {localizeDigits(lastNum, locale)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('start_game')}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => { setSpeed(s.key); sfx.click(); }}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-black transition-colors ${
                      speed === s.key ? 'bg-amber-500/25 text-amber-300' : 'text-muted-foreground hover:bg-muted'
                    }`}
                    aria-pressed={speed === s.key}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* outcome */}
            {atEnd && (
              <div className="animate-pop rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 to-fuchsia-500/15 px-3 py-2 text-center text-sm font-black">
                {data.winner === 'DRAW'
                  ? t('draw')
                  : `${t('victory')}: ${data.winner === 'P1' ? data.p1Name : data.p2Name} · ${
                      data.endReason === 'KIND' ? t('win_kind') : data.endReason === 'RUN' ? t('win_run') : ''
                    }`}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* rebuild a consistent GameState from a move prefix */
function buildState(numbers: (number | null)[], history: number[], boardId: string): GameState {
  const s = createGame(numbers, boardId);
  for (const col of history) {
    if (applyMove(s, col) < 0) break; // tolerate corrupt tails
  }
  return s;
}

async function apiFetch(gameId: string): Promise<ReplayDTO> {
  const res = await fetch(`/api/game/replay?id=${encodeURIComponent(gameId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('replay failed');
  return (await res.json()) as ReplayDTO;
}
