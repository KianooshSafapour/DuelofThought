'use client';

/**
 * GameScreen — orchestrates a full match: local 2P, vs AI, or online (socket).
 * Handles turns, AI thinking, resign, hint, timers, post-game rewards (submit
 * to /api/game/submit for PVE/local) and the "insight card" (educational feedback).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameState, PlayerId, createGame, applyMove, cloneState, insightFor } from '@/lib/game/engine';
import { chooseMove, Difficulty } from '@/lib/game/ai';
import { getBoard } from '@/lib/game/boards';
import { STORE_ITEMS, ALL_EMOTES, emotePackList } from '@/lib/game/content';
import { GameBoard, BoardPalette } from './GameBoard';
import { useApp } from '@/store/app';
import { api, ApplyResultDTO } from '@/lib/api';
import { sfx } from '@/lib/sound';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { RotateCw, Flag, Lightbulb, Volume2, VolumeX, Swords, BrainCircuit, Undo2 } from 'lucide-react';
import { localizeDigits } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PixelSprite } from '@/components/shared/PixelSprite';
import { WinFireworks, effectSkinVisual } from '@/components/game/WinFireworks';
import { CelebrationSprite } from '@/components/shared/CelebrationSprite';

type Mode = 'ai' | 'local';

/** emote id → emoji across ALL packs (receivers resolve any incoming id; mirrors socket allowlist charset) */
const EMOTE_MAP: Record<string, string> = ALL_EMOTES;

export interface OnlineGameHooks {
  mySide: PlayerId;
  sendMove: (col: number) => void;
  sendResign: () => void;
  opponentName: string;
  opponentAvatar: string;
  opponentPieceSkin?: string;
  sendRematch: () => void;
  chat: { from: string; text: string }[];
  sendChat: (text: string) => void;
  emotes: { from: string; id: string }[];
  sendEmote: (id: string) => void;
}

export interface OnlineRewards {
  coins: number; xp: number; eloDelta: number | null; level: number;
  unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[];
}

export function GameScreen({
  mode, aiLevel, boardId, customNumbers, online, onlineState, onlineRewards, onExit,
}: {
  mode: Mode | 'online';
  aiLevel: Difficulty;
  boardId: string;
  /** optional layout override for team-designed boards (PlayView passes the parsed numbers) */
  customNumbers?: (number | null)[];
  online?: OnlineGameHooks;
  onlineState?: GameState | null;
  onlineRewards?: OnlineRewards | null;
  onExit: () => void;
}) {
  const { t, locale, user, owned, patchUser, perfMode } = useApp();
  const board = useMemo(() => getBoard(boardId), [boardId]);
  // team board override: when provided it wins over the (cache-resolved) catalog numbers
  const numbers = useMemo(() => customNumbers ?? board.numbers, [customNumbers, board.numbers]);
  const [state, setState] = useState<GameState>(() => createGame(numbers, board.id));
  const [thinking, setThinking] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [hintCol, setHintCol] = useState<number | null>(null);
  const [settling, setSettling] = useState(false); // post-game modal open
  const [result, setResult] = useState<ApplyResultDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [askResign, setAskResign] = useState(false);
  const startedAt = useRef(Date.now());
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false); // guards double finishGame submission (modal close must NOT re-fire)

  /* server-authoritative online state sync */
  const onlineCounts = (s: GameState) => {
    if (s.counts && s.counts[0]) return s;
    s.counts = [new Uint8Array(10), new Uint8Array(10)];
    for (const c of s.cells) if (c.o === 1 || c.o === 2) { if (c.n) s.counts[c.o - 1][c.n]++; }
    return s;
  };
  useEffect(() => {
    if (mode === 'online' && onlineState) {
      setState(onlineCounts(onlineState));
      if (onlineState.lastMove !== null) {
        const n = onlineState.cells[onlineState.lastMove].n;
        if (n !== null) sfx.capture(); else sfx.drop();
      }
      if (onlineState.result) {
        if (onlineState.result.winner === 0) { sfx.lose(); }
        else if (onlineState.result.winner === (online?.mySide ?? 1)) { sfx.win(); if (onlineRewards?.coins) sfx.coin(); setCelebrate(true); setTimeout(() => setCelebrate(false), 3400); }
        else sfx.lose();
        setSettling(true); // open post-game modal for online matches too
      }
    }
  }, [onlineState, mode]);

  /* team board that vanished (deleted/unpublished mid-session): getBoard
   * silently fell back to classic — tell the player once instead of confusing them */
  useEffect(() => {
    if (/^c[a-z0-9-]+$/.test(boardId) && board.id !== boardId) toast.error(t('board_custom_missing'));
  }, [boardId]);

  const piece1 = user?.pieceSkin && owned.includes(user.pieceSkin) ? user.pieceSkin : 'piece_terracotta';
  const piece2 = online?.opponentPieceSkin ?? 'piece_jade';
  const palette = useMemo<BoardPalette>(() => {
    const item = STORE_ITEMS.find((i) => i.code === (user?.boardSkin && owned.includes(user.boardSkin) ? user.boardSkin : 'board_classic'));
    return (item?.data ?? {}) as unknown as BoardPalette;
  }, [user?.boardSkin, owned]);

  const localPlayerName = (p: PlayerId) => (mode === 'local' ? (p === 1 ? t('player1') : t('player2')) : p === 1 ? (user?.username ?? t('you')) : `AI ${aiLevel}`);

  /* human-readable end reason, perspective-aware:
   * won=null → neutral (local PvP), true → viewer won (opponent resigned/timed out), false → viewer lost */
  const winReasonText = (type: string | null, won: boolean | null) => {
    if (type === 'KIND') return t('win_kind');
    if (type === 'RUN') return t('win_run');
    if (type === 'FULL') return t('draw_full');
    if (type === 'TIMEOUT') return won === null ? t('win_timeout') : won ? t('timeout_opp') : t('timeout_you');
    return won === null ? t('win_resign') : won ? t('resign_opp') : t('resign_you');
  };

  const viewerWon: boolean | null = state.result
    ? mode === 'ai'
      ? state.result.winner === 1
      : mode === 'online'
        ? state.result.winner === (online?.mySide ?? 1)
        : null
    : null;

  /* ------------------ finishing flow ------------------ */
  const finishGame = useCallback(async (s: GameState) => {
    // single-shot guard: doResign/handleColumn may call this directly AND the
    // game-over watch-effect fires right after the same state commit — without
    // this, two identical submissions race (one 200 + one spurious DUPLICATE toast)
    if (finishedRef.current) return;
    finishedRef.current = true;
    setSettling(true);
    if (mode === 'online' || !user) return;
    // build submission for PVE / local
    const winner: 'P1' | 'P2' | 'DRAW' = s.result ? (s.result.winner === 1 ? 'P1' : s.result.winner === 2 ? 'P2' : 'DRAW') : 'DRAW';
    const endReason = s.result?.type === 'KIND' || s.result?.type === 'RUN' ? s.result.type : s.result?.type === 'FULL' ? 'FULL' : 'RESIGN';
    const duration = Date.now() - startedAt.current;
    setSubmitting(true);
    try {
      const submitPayload = {
        mode: mode === 'ai' ? 'PVE' : 'LOCAL_PVP',
        boardId: s.boardId,
        aiLevel: mode === 'ai' ? aiLevel : undefined,
        endReason,
        winner,
        winNumbers: s.result?.numbers ?? [],
        history: s.history,
        durationMs: Math.min(duration, 4 * 3600_000),
        opponentName: mode === 'ai' ? `AI ${aiLevel}` : t('player2'),
      };
      let res: ApplyResultDTO;
      try {
        res = await api.post<ApplyResultDTO>('/api/game/submit', submitPayload);
      } catch (err) {
        /* stale custom board: the client silently fell back to the classic layout,
         * so the replay is valid as 'classic' — retry once so the player keeps rewards */
        if ((err as Error).message === 'BOARD_NOT_FOUND' && /^c[a-z0-9-]+$/.test(s.boardId)) {
          useApp.getState().setGameSettings({ boardId: 'classic' });
          res = await api.post<ApplyResultDTO>('/api/game/submit', { ...submitPayload, boardId: 'classic' });
        } else {
          throw err;
        }
      }
      setResult(res);
      if (res.coins > 0) sfx.coin();
      if (res.unlockedAchievements.length > 0) sfx.achievement();
      if (res.levelUps > 0) sfx.levelup();
      patchUser(res.user);
    } catch (e) {
      console.error('submit failed', e);
      const code = (e as Error).message;
      toast.error(code === 'DUPLICATE' ? t('e_duplicate') : code === 'RATE' ? t('e_rate') : t('error'));
    } finally {
      setSubmitting(false);
    }
  }, [mode, user, aiLevel, patchUser, t]);

  /* resign */
  const doResign = useCallback(() => {
    if (state.result) return;
    if (mode === 'online' && online) { online.sendResign(); sfx.lose(); return; }
    const s = cloneState(state);
    const loser: PlayerId = 1; // local resign = P1 concedes; AI mode human concedes
    const winner: PlayerId = loser === 1 ? 2 : 1;
    s.result = { winner, type: 'RESIGN', numbers: [], winCells: [] };
    setState(s);
    sfx.lose();
    void finishGame(s);
  }, [state, mode, online, finishGame]);

  /* ------------------ AI turn ------------------ */
  useEffect(() => {
    if (mode !== 'ai') return;
    if (state.result || state.turn !== 2) return;
    setThinking(true);
    const delay = 350 + Math.random() * 550;
    aiTimer.current = setTimeout(() => {
      const s = cloneState(state);
      const col = chooseMove(s, aiLevel);
      if (col >= 0) {
        const cellN = s.cells[s.heights[col] * 9 + col]?.n;
        applyMove(s, col);
        setState(s);
        if (cellN !== null) sfx.capture(); else sfx.drop();
      }
      setThinking(false);
    }, delay);
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current); };
  }, [state, mode, aiLevel]);

  /* watch for game over (non-online) — submission itself is guarded inside finishGame */
  useEffect(() => {
    if (mode !== 'online' && state.result && !finishedRef.current) {
      const won = mode === 'ai' ? state.result.winner === 1 : true;
      if (won) { sfx.win(); setCelebrate(true); setTimeout(() => setCelebrate(false), 3400); } else sfx.lose();
      void finishGame(state);
    }
  }, [state.result, mode, finishGame]);

  /* ------------------ interactions ------------------ */
  const myTurn = mode === 'local' ? !state.result : mode === 'ai' ? state.turn === 1 && !state.result : online ? state.turn === online.mySide && !state.result : false;

  const handleColumn = useCallback((col: number) => {
    if (!myTurn) { sfx.bad(); return; }
    if (mode === 'online' && online) { online.sendMove(col); return; }
    const s = cloneState(state);
    const cellN = s.cells[s.heights[col] * 9 + col]?.n;
    if (applyMove(s, col) < 0) { sfx.bad(); return; }
    setState(s);
    setHintCol(null);
    if (cellN !== null) sfx.capture(); else sfx.drop();
    if (mode === 'local' && s.result) void finishGame(s);
  }, [myTurn, mode, state, online, finishGame]);

  const showHint = () => {
    if (!myTurn) return;
    const s = cloneState(state);
    const col = chooseMove(s, 'MEDIUM');
    if (col >= 0) { setHintCol(col); sfx.click(); toast.info(t('hint_used')); }
  };

  /* take-back: rewind 1 ply (local) or 2 plies (vs AI, so it stays your turn) */
  const canUndo = (mode === 'ai' || mode === 'local') && !state.result && !thinking && state.history.length > 0;
  const undoMove = () => {
    if (!canUndo) return;
    const steps = mode === 'ai' ? Math.min(2, state.history.length) : 1;
    const s = createGame(numbers, board.id);
    for (const col of state.history.slice(0, state.history.length - steps)) applyMove(s, col);
    setState(s);
    setHintCol(null);
    sfx.click();
  };

  /* keyboard controls: 1-9 drop into columns (a11y + speed play) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= 9) {
        if (myTurn) handleColumn(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [myTurn, handleColumn]);

  const restart = () => {
    setCelebrate(false);
    if (mode === 'online' && online) { online.sendRematch(); toast.info(t('rematch_wait')); return; }
    setState(createGame(numbers, board.id));
    setResult(null);
    setSettling(false);
    setHintCol(null);
    startedAt.current = Date.now();
    finishedRef.current = false;
  };

  const insightP = mode === 'ai' ? (insightFor(state, 1)) : insightFor(state, 1);
  const turnLabel = mode === 'online'
    ? (state.turn === online?.mySide ? t('your_turn') : t('opp_turn'))
    : mode === 'ai' ? (state.turn === 1 ? t('your_turn') : t('thinking'))
      : (state.turn === 1 ? t('p1_turn') : t('p2_turn'));

  const piecesP1 = state.piecesLeft[0];
  const piecesP2 = state.piecesLeft[1];

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-6 pt-2">
      {/* win celebration overlay (equipped effect skin) */}
      <WinFireworks active={celebrate} {...effectSkinVisual(user?.effectSkin ?? 'fx_confetti')} />
      {/* floating emote bubbles (online) */}
      {mode === 'online' && online && online.emotes.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-1">
          {online.emotes.slice(-4).map((em, i) => (
            <div key={`${em.from}-${i}`} className="animate-pop rounded-full border border-amber-400/40 bg-background/90 px-3 py-1 text-lg shadow-lg" dir="ltr">
              {EMOTE_MAP[em.id] ?? '👋'} <span className="text-xs font-bold text-amber-400">{em.from}</span>
            </div>
          ))}
        </div>
      )}
      {/* scoreboard */}
      <div className="mb-3 flex items-stretch justify-between gap-2">
        <PlayerChip
          name={mode === 'online' ? (online?.mySide === 1 ? (user?.username ?? t('you')) : (online?.opponentName ?? '')) : localPlayerName(1)}
          pieces={piecesP1}
          active={state.turn === (mode === 'online' ? (online?.mySide ?? 1) : 1) && !state.result}
          pieceCode={mode === 'online' && online?.mySide === 2 ? piece2 : piece1}
          side={1}
          score1={state.counts?.[0] ?? new Uint8Array(10)}
        />
        <div className="flex flex-col items-center justify-center text-center">
          <div className="text-[10px] text-muted-foreground">{t('move_time')} <MoveTimer key={state.ply} paused={!!state.result} /> </div>
          <div className={`text-sm font-bold ${thinking ? 'animate-pulse text-amber-400' : 'gold-text'}`}>{turnLabel}</div>
          <div className="text-[10px] text-muted-foreground">{localizeDigits(state.ply, locale)}/۶۳</div>
        </div>
        <PlayerChip
          align="end"
          name={mode === 'online' ? (online?.mySide === 2 ? (user?.username ?? t('you')) : (online?.opponentName ?? '')) : localPlayerName(2)}
          pieces={piecesP2}
          active={state.turn === (mode === 'online' ? (online?.mySide === 2 ? 2 : 2) : 2) && !state.result}
          pieceCode={mode === 'online' && online?.mySide === 2 ? piece1 : piece2}
          side={2}
          score1={state.counts?.[1] ?? new Uint8Array(10)}
        />
      </div>

      {/* GameBoard gets ghost preview of the dropping piece */}
      <GameBoard
        state={state}
        palette={palette}
        piece1={mode === 'online' && online?.mySide === 2 ? piece2 : piece1}
        piece2={mode === 'online' && online?.mySide === 2 ? piece1 : piece2}
        onColumnClick={handleColumn}
        interactive={myTurn}
        rotated={rotated}
        hintCol={hintCol}
      />

      {/* move log strip — tactical history of column drops */}
      <MoveLogStrip history={state.history} />

      {/* controls */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { setRotated((r) => !r); sfx.click(); }}>
          <RotateCw className="h-4 w-4" /> {t('rotate_view')}
        </Button>
        <Button variant="outline" size="sm" onClick={showHint} disabled={!myTurn || mode === 'online'}>
          <Lightbulb className="h-4 w-4" /> {t('hint')}
        </Button>
        <Button variant="outline" size="sm" onClick={undoMove} disabled={!canUndo} title={t('undo')}>
          <Undo2 className="h-4 w-4" /> {t('undo')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { const v = !(user?.soundOn ?? true); patchUser({ soundOn: v }); }}>
          {(user?.soundOn ?? true) ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setAskResign(true)} disabled={!!state.result}>
          <Flag className="h-4 w-4" /> {t('resign')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onExit}>{t('back_hub')}</Button>
        <span className="hidden items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground sm:inline-flex" title="keyboard">⌨️ 1–9</span>
      </div>

      {/* emote bar (online) — shows the equipped pack */}
      {mode === 'online' && online && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {emotePackList(user?.emotePack).map(({ id, emoji }) => (
            <button
              key={id}
              onClick={() => { online.sendEmote(id); sfx.click(); }}
              className="royal-card rounded-full px-3 py-1.5 text-lg transition-transform hover:scale-110 active:scale-95"
              aria-label={`emote ${id}`}
              title={id}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* online chat */}
      {mode === 'online' && online && (
        <div className="royal-card mt-4 rounded-xl p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Swords className="h-4 w-4 text-amber-400" /> {t('chat')}
          </div>
          <div className="nice-scroll mb-2 flex max-h-32 flex-col gap-1 overflow-y-auto" dir="auto">
            {online.chat.map((c, i) => {
              const own = c.from === (user?.username ?? 'me');
              return (
                <div
                  key={i}
                  className={cn('chat-bubble animate-pop', own ? 'chat-bubble-own' : 'chat-bubble-other')}
                >
                  {!own && <b className="me-1 text-amber-400">{c.from}:</b>}
                  {c.text}
                </div>
              );
            })}
            {online.chat.length === 0 && <div className="text-xs text-muted-foreground">…</div>}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatDraft.trim()) { online.sendChat(chatDraft.trim().slice(0, 200)); setChatDraft(''); }
            }}
          >
            <input
              className="flex-1 rounded-lg border bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder={t('chat_placeholder')}
              maxLength={200}
              dir="auto"
            />
            <Button type="submit" size="sm" variant="secondary">{t('confirm')}</Button>
          </form>
        </div>
      )}

      {/* resign confirm (styled replacement for native confirm) */}
      <AlertDialog open={askResign} onOpenChange={setAskResign}>
        <AlertDialogContent dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'} className="royal-card">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resign_confirm')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => { setAskResign(false); doResign(); }}
            >
              {t('resign')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* post-game modal */}
      <Dialog open={!!state.result && settling} onOpenChange={(o) => !o && setSettling(false)}>
        <DialogContent className="royal-card card-shine nice-scroll max-h-[85dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined} dir={locale === 'fa' || locale === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-center text-2xl">
              {state.result ? (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="animate-pop text-5xl drop-shadow-[0_0_18px_rgba(245,158,11,.45)]" aria-hidden>
                    {state.result.winner === 0
                      ? '🤝'
                      : mode === 'online'
                        ? (state.result.winner === (online?.mySide ?? 1) ? '🏆' : '🛡️')
                        : mode === 'ai'
                          ? (state.result.winner === 1 ? '🏆' : '🛡️')
                          : '🏆'}
                  </span>
                  {state.result.winner === 0 ? (
                    <span className="gold-text">{t('draw')}</span>
                  ) : mode === 'online' ? (
                    state.result.winner === (online?.mySide ?? 1) ? <span className="gold-text">{t('victory')}</span> : <span className="text-rose-400">{t('defeat')}</span>
                  ) : mode === 'ai' ? (
                    state.result.winner === 1 ? <span className="gold-text">{t('victory')}</span> : <span className="text-rose-400">{t('defeat')}</span>
                  ) : (
                    <span className="gold-text">{winReasonText(state.result.type, viewerWon)}</span>
                  )}
                </div>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {state.result && state.result.winner !== 0 && (mode === 'local' || viewerWon) && (
            /* equipped celebration pack dances on victory (static pose in perf mode) */
            <div className="mb-1 flex justify-center">
              <CelebrationSprite code={user?.celebrationPack} dancing={!perfMode} size={96} />
            </div>
          )}

          {state.result && state.result.winner !== 0 && (
            <div className="mb-2 text-center text-sm">
              {(state.result.type === 'KIND' || state.result.type === 'RUN') && state.result.numbers.length > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {mode !== 'local' && <span className="font-bold text-amber-400">{winReasonText(state.result.type, viewerWon)}</span>}
                  {state.result.numbers.map((n, i) => (
                    <span
                      key={`${n}-${i}`}
                      className="animate-pop rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-sm font-black text-amber-300 shadow-[0_0_10px_rgba(245,158,11,.15)]"
                      style={{ animationDelay: `${i * 90}ms` }}
                    >
                      {localizeDigits(n, locale)}
                    </span>
                  ))}
                </div>
              ) : mode !== 'local' ? (
                <span className="font-bold text-amber-400">{winReasonText(state.result.type, viewerWon)}</span>
              ) : null}
            </div>
          )}

          {/* rewards */}
          {(submitting || result || (mode === 'online' && onlineRewards)) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-1 flex items-center justify-center gap-2 text-sm font-bold"><BrainCircuit className="h-4 w-4" /> {t('rewards_title')}</div>
              {submitting && <div className="py-3 text-center text-xs text-muted-foreground animate-pulse">{t('loading')}</div>}
              {result && (
                <div className="space-y-2">
                  <div className="flex justify-center gap-4 text-lg font-black">
                    <span className="animate-coin-fly" key={`c-${result.coins}`}>🪙 +{localizeDigits(result.coins, locale)}</span>
                    <span className="text-emerald-400">✦ +{localizeDigits(result.xp, locale)} {t('xp')}</span>
                  </div>
                  {result.eloDelta !== null && (
                    <div className="text-center text-xs text-muted-foreground">
                      {t('rating')}: {result.eloDelta >= 0 ? '+' : ''}{localizeDigits(result.eloDelta, locale)}
                    </div>
                  )}
                  {result.unlockedAchievements.map((a) => (
                    <div key={a.id} className="animate-pop rounded-lg bg-gradient-to-r from-amber-500/20 to-fuchsia-500/20 px-3 py-1.5 text-center text-sm font-bold">
                      🏅 {t('ach_unlocked')} +{localizeDigits(a.coins, locale)} 🪙
                    </div>
                  ))}
                  {result.levelUps > 0 && (
                    <div className="animate-pop rounded-lg bg-gradient-to-r from-emerald-500/25 to-amber-500/25 px-3 py-1.5 text-center text-sm font-black">
                      ⬆ {t('level_up')} {localizeDigits(result.user.level, locale)}
                    </div>
                  )}
                </div>
              )}
              {!submitting && !result && mode === 'online' && onlineRewards && (
                <div className="space-y-2">
                  <div className="flex justify-center gap-4 text-lg font-black">
                    <span className="animate-coin-fly" key={`oc-${onlineRewards.coins}`}>🪙 +{localizeDigits(onlineRewards.coins, locale)}</span>
                    <span className="text-emerald-400">✦ +{localizeDigits(onlineRewards.xp, locale)} {t('xp')}</span>
                  </div>
                  {onlineRewards.eloDelta !== null && (
                    <div className="text-center text-xs text-muted-foreground">
                      {t('rating')}: {onlineRewards.eloDelta >= 0 ? '+' : ''}{localizeDigits(onlineRewards.eloDelta, locale)}
                    </div>
                  )}
                  {onlineRewards.unlockedAchievements.map((a) => (
                    <div key={a.id} className="animate-pop rounded-lg bg-gradient-to-r from-amber-500/20 to-fuchsia-500/20 px-3 py-1.5 text-center text-sm font-bold">
                      🏅 {t('ach_unlocked')} +{localizeDigits(a.coins, locale)} 🪙
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* insight card (educational feedback loop) */}
          <div className="rounded-xl border p-3 text-sm">
            <div className="mb-2 font-bold">📊 {t('insight_title')}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted p-2">
                <div className="text-lg font-black text-amber-400">{localizeDigits(insightP.captured, locale)}</div>
                <div className="text-[10px] text-muted-foreground">{t('insight_captured')}</div>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <div className="text-lg font-black text-fuchsia-400">
                  {insightP.bestKind > 0 ? `${localizeDigits(insightP.bestKind, locale)}×${localizeDigits(insightP.bestKindNum, locale)}` : '—'}
                </div>
                <div className="text-[10px] text-muted-foreground">{t('insight_bestkind')}</div>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <div className="text-lg font-black text-emerald-400">
                  {insightP.bestRunWin.length ? insightP.bestRunWin.map((n) => localizeDigits(n, locale)).join('') : '—'}
                </div>
                <div className="text-[10px] text-muted-foreground">{t('insight_bestrun')}</div>
              </div>
            </div>
            {insightP.bestRunWin.length > 0 && insightP.bestRunWin.length < 4 && (
              <div className="mt-2 text-center text-xs text-muted-foreground">
                {t('insight_next')}: {insightP.bestRunWin.map((n) => localizeDigits(n, locale)).join('، ')}
              </div>
            )}
          </div>

          <div className="flex justify-center gap-2 pt-1">
            <Button onClick={restart} className="glow-gold">{t('play_again')}</Button>
            <Button variant="outline" onClick={onExit}>{t('back_hub')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlayerChip({
  name, pieces, active, pieceCode, side, align = 'start', score1,
}: {
  name: string; pieces: number; active: boolean; pieceCode: string; side: 1 | 2;
  align?: 'start' | 'end'; score1: Uint8Array;
}) {
  const t = useApp((s) => s.t);
  const best = Array.from(score1).reduce((a, b) => Math.max(a, b), 0);
  return (
    <div className={`royal-card flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2 transition-all duration-300 ${active ? 'glow-gold scale-[1.025]' : 'opacity-75'} ${align === 'end' ? 'flex-row-reverse text-end' : ''}`}>
      <div className="shrink-0"><PixelSprite kind="piece" code={pieceCode} side={side} scale={3} /></div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-xs font-bold">
          {active && (
            <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
            </span>
          )}
          <span className="truncate">{name}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">{pieces} {t('pieces_left')}</div>
        {best >= 2 && <div className="text-[10px] font-bold text-amber-400">max {best}×</div>}
      </div>
    </div>
  );
}

/** Per-move stopwatch; remounted (via key=ply) whenever a new piece lands. */
function MoveTimer({ paused }: { paused?: boolean }) {
  const locale = useApp((s) => s.locale);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (paused) return; // freeze the clock once the duel ends
    const iv = setInterval(() => setSec((s) => Math.min(s + 1, 5999)), 1000);
    return () => clearInterval(iv);
  }, [paused]);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    <span className="font-mono text-[10px] tabular-nums" dir="ltr">
      {localizeDigits(m, locale)}:{localizeDigits(String(s).padStart(2, '0'), locale)}
    </span>
  );
}

/** Compact tactical move log: one chip per ply (side dot + column), auto-scrolls to the latest. */
function MoveLogStrip({ history }: { history: number[] }) {
  const t = useApp((s) => s.t);
  const locale = useApp((s) => s.locale);
  const scroller = useRef<HTMLDivElement>(null);
  const lastPly = history.length;
  useEffect(() => {
    // keep the newest chip visible (container is always dir=ltr, so scroll right)
    scroller.current?.scrollTo({ left: 99999, behavior: 'smooth' });
  }, [lastPly]);
  if (!lastPly) return null;
  return (
    <div className="royal-card mt-2 flex items-center gap-2 rounded-xl px-2 py-1.5" aria-label={t('move_log')}>
      <span className="shrink-0 text-[10px] font-bold text-muted-foreground">📜 {t('move_log')}</span>
      <div ref={scroller} className="nice-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5" dir="ltr">
        {history.map((col, i) => {
          const side = i % 2 === 0 ? 1 : 2;
          const isLast = i === lastPly - 1;
          return (
            <span
              key={i}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
                side === 1
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                  : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
              } ${isLast ? 'animate-pop ring-1 ring-amber-300/50' : 'opacity-80'}`}
              title={`#${localizeDigits(i + 1, locale)}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${side === 1 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              {localizeDigits(col + 1, locale)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
