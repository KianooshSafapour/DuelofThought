'use client';

/**
 * PlayView — mode selection lobby: vs AI (3 difficulties), local 2P,
 * online (ranked / casual / private room / friend challenges).
 * A lightweight "presence" socket lives in the lobby: it registers the player
 * in the park, receives friend challenges, and is handed off to the game
 * pipeline when a challenge is accepted. Renders GameScreen when a match starts.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { GameScreen, OnlineGameHooks, OnlineRewards } from '@/components/game/GameScreen';
import { FriendsPanel } from '@/components/game/FriendsPanel';
import { GameState } from '@/lib/game/engine';
import { Difficulty } from '@/lib/game/ai';
import { BOARD_CATALOG, layoutFromCustom, setCustomBoards } from '@/lib/game/boards';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { sfx } from '@/lib/sound';
import { localizeDigits } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { Bot, Users, Globe, Crown, Loader2, LogIn, Plus, X, Swords, Copy, Zap, Palette } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

type Phase = 'lobby' | 'game';

/** published team-designed board as served by GET /api/boards */
interface TeamBoard {
  code: string; nameFa: string; nameEn: string; layout: number[]; plays: number;
}

interface IncomingChallenge {
  id: string;
  at: number;
  from: { id: string; username: string; avatarItem: string; rating: number; level: number };
}

const CHALLENGE_TTL_S = 30;

export function PlayView() {
  const { t, locale, user, gameSettings, setGameSettings } = useApp();
  const [phase, setPhase] = useState<Phase>('lobby');
  const [onlineHooks, setOnlineHooks] = useState<OnlineGameHooks | null>(null);
  const [onlineState, setOnlineState] = useState<GameState | null>(null);
  const [onlineRewards, setOnlineRewards] = useState<OnlineRewards | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const presenceRef = useRef<Socket | null>(null);
  const [searching, setSearching] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState<string | null>(null);
  const [presence, setPresence] = useState<{ players: number; rooms: number } | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState(false);
  const [challengeOut, setChallengeOut] = useState<{ id: string; name: string } | null>(null);
  const [challengeIn, setChallengeIn] = useState<IncomingChallenge | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [leftSec, setLeftSec] = useState(CHALLENGE_TTL_S);
  const [teamBoards, setTeamBoards] = useState<TeamBoard[]>([]);
  /** parsed layout of the selected team board (c<code>) — handed to GameScreen */
  const [customNumbers, setCustomNumbers] = useState<(number | null)[] | null>(null);

  const userId = user?.id ?? null;
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  /* ---------------- team-designed boards (AI / local only) ----------------
   * Fetched once per mount; ALSO populates the module-level custom-board
   * cache in lib/game/boards so getBoard("c<code>") resolves synchronously
   * (restart / undo paths inside GameScreen rely on it). Online duels are NOT
   * covered: the socket referee (duel-socket service) builds its own boards
   * and has no custom-board support yet — the strip is hidden during any
   * online activity below, and the override is cleared when a match arrives. */
  useEffect(() => {
    let live = true;
    api.get<TeamBoard[]>('/api/boards')
      .then((list) => {
        if (!live || !Array.isArray(list)) return;
        setTeamBoards(list);
        setCustomBoards(list.map((b) => ({ code: b.code, layout: b.layout })));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  /* ---------------- online plumbing ---------------- */
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      presenceRef.current?.disconnect();
    };
  }, []);

  /* live park presence — polls the duel-socket health endpoint via the gateway */
  useEffect(() => {
    if (phase !== 'lobby') return;
    let live = true;
    const poll = () => {
      fetch('/?XTransformPort=3003', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { players?: number; rooms?: number } | null) => {
          if (live && d && typeof d.players === 'number') setPresence({ players: d.players, rooms: d.rooms ?? 0 });
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { live = false; clearInterval(id); };
  }, [phase]);

  /* ---------------- shared in-game event pipeline ----------------
   * Attached to whichever socket ends up carrying the match (queue socket,
   * private-room socket, or the handed-off lobby presence socket).
   * reassertOnReconnect: game sockets re-emit their queue intent after a
   * transient drop (R7 recovery); the idle lobby socket must NOT — defaulting
   * true there made every lobby browser phantom-queue into casual matchmaking
   * whenever the referee service hiccuped. */
  const attachGameHandlers = (socket: Socket, reassertOnReconnect: boolean) => {
    const chat: { from: string; text: string }[] = [];
    const emotes: { from: string; id: string }[] = [];
    let inLiveGame = reassertOnReconnect; // cleared when the final state (result) arrives

    socket.on('match', (d: {
      yourSide: 1 | 2; boardId: string; ranked?: boolean;
      opponent: { username: string; avatarItem: string; rating: number; level: number; pieceSkin?: string; boardSkin?: string };
    }) => {
      chat.length = 0;
      emotes.length = 0;
      inLiveGame = true;
      const hooks: OnlineGameHooks & { socket: Socket; boardId: string } = {
        socket,
        boardId: d.boardId,
        mySide: d.yourSide,
        opponentName: d.opponent.username,
        opponentAvatar: d.opponent.avatarItem,
        opponentPieceSkin: d.opponent.pieceSkin,
        chat,
        emotes,
        sendMove: (col: number) => socket.emit('move', { col }),
        sendResign: () => socket.emit('resign'),
        sendRematch: () => socket.emit('rematch:accept'),
        sendChat: (text: string) => socket.emit('chat', { text }),
        sendEmote: (id: string) => socket.emit('emote', { id }),
      };
      setOnlineHooks(hooks);
      setOnlineState(null);
      setOnlineRewards(null);
      setSearching(false);
      setWaitingRoom(null);
      setChallengeOut(null);
      setChallengeIn(null);
      setGameSettings({ boardId: d.boardId });
      setCustomNumbers(null); // online boards come from the referee service
      setPhase('game');
      sfx.capture();
    });

    socket.on('move:bad', () => { sfx.bad(); toast.error(t('error')); });
    socket.on('state', (d: { state: GameState }) => {
      const s = typeof d.state === 'string' ? (JSON.parse(d.state) as GameState) : d.state;
      if (s.result) inLiveGame = false;
      setOnlineState(s);
    });
    socket.on('game:rewards', (d: OnlineRewards) => {
      setOnlineRewards(d);
      void useApp.getState().refreshSession();
    });
    socket.on('chat', (d: { from: string; text: string }) => {
      chat.push(d);
      sfx.chat();
      setOnlineHooks((h) => (h ? { ...h, chat: [...chat] } : h));
    });
    socket.on('emote', (d: { from: string; id: string }) => {
      emotes.push(d);
      sfx.chat();
      setOnlineHooks((h) => (h ? { ...h, emotes: [...emotes] } : h));
      setTimeout(() => {
        emotes.splice(0, emotes.length);
        setOnlineHooks((h) => (h ? { ...h, emotes: [] } : h));
      }, 4000);
    });
    socket.on('chat:blocked', () => toast.error(t('chat_blocked')));
    socket.on('opponent:left', () => toast.info(t('opponent_left')));
    // mid-game reconnect: after a transient drop the manager retries, and on
    // success we re-assert the intent — the server resumes an ACTIVE room
    // (rejoin) instead of queueing, so the board continues seamlessly
    socket.io.on('reconnect', () => {
      if (inLiveGame) socket.emit('queue:join', { ranked: false });
    });
    socket.on('game:over', () => { inLiveGame = false; /* server pushes final state via state event */ });
  };

  /* ---------------- lobby presence socket (friends + challenges) ---------------- */
  useEffect(() => {
    if (phase !== 'lobby' || !userId) return;
    let handedOff = false;
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });
    presenceRef.current = socket;
    attachGameHandlers(socket, false); // lobby socket: presence + challenges only

    socket.on('connect', () => socket.emit('presence:hello'));
    socket.io.on('reconnect', () => socket.emit('presence:hello'));

    socket.on('challenge:sent', (d: { id: string; to: { username: string } }) => {
      setChallengeOut({ id: d.id, name: d.to.username });
      toast.info(`${t('challenge_sent')} — ${d.to.username}`);
    });
    socket.on('challenge:incoming', (d: IncomingChallenge) => {
      // challenges are only receivable in the park lobby — mid-duel we silently
      // auto-decline so the sender isn't left waiting for the 30s TTL
      if (phaseRef.current !== 'lobby') {
        socket.emit('challenge:decline', { id: d.id });
        return;
      }
      setChallengeIn({ ...d, at: Date.now() });
      sfx.achievement();
    });
    socket.on('challenge:declined', () => {
      setChallengeOut(null);
      sfx.bad();
      toast.info(t('challenge_declined_toast'));
    });
    socket.on('challenge:cancelled', () => {
      setChallengeOut((c) => (c ? null : c));
      toast.info(t('challenge_cancelled_toast'));
    });
    socket.on('challenge:expired', () => {
      setChallengeOut(null);
      setChallengeIn(null);
      toast.info(t('challenge_expired_toast'));
    });
    socket.on('error', (d: { code?: string }) => {
      setChallengeOut(null);
      setAccepting(false);
      const map: Record<string, string> = {
        CHALLENGE_BUSY: t('challenge_busy_toast'),
        CHALLENGE_GONE: t('challenge_gone_toast'),
        CHALLENGE_DUP: t('e_fr_pending'),
        CHALLENGE_SELF: t('e_fr_self'),
        NOT_FOUND: t('challenge_gone_toast'),
      };
      if (d?.code && map[d.code]) toast.error(map[d.code]);
    });
    socket.on('disconnect', () => {
      setChallengeOut((c) => (c ? null : c));
    });

    // a match can arrive on this socket when a friend challenge is accepted —
    // hand the socket over to the game pipeline instead of tearing it down
    socket.on('match', () => {
      handedOff = true;
      presenceRef.current = null;
      socketRef.current = socket;
      setAccepting(false);
    });

    return () => {
      presenceRef.current = null;
      if (!handedOff) socket.disconnect();
    };
  }, [phase, userId]);

  /* cross-view challenge handoff — the leaderboard (or profile) sets
   * pendingChallenge and navigates here; once the lobby socket is live we fire
   * the challenge and clear the handoff (retry ~10s, then give up gracefully) */
  const pendingChallenge = useApp((s) => s.pendingChallenge);
  const setPendingChallenge = useApp((s) => s.setPendingChallenge);
  useEffect(() => {
    if (!pendingChallenge || phase !== 'lobby' || !userId) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      const socket = presenceRef.current;
      if (socket?.connected) {
        clearInterval(iv);
        socket.emit('challenge:send', { toUserId: pendingChallenge.userId });
        setPendingChallenge(null);
      } else if (tries > 25) {
        clearInterval(iv);
        setPendingChallenge(null);
        toast.error(t('challenge_gone_toast'));
      }
    }, 400);
    return () => clearInterval(iv);
  }, [pendingChallenge, phase, userId, setPendingChallenge, t]);

  /* countdown bar for the incoming challenge dialog — deadline derived from
   * arrival time so no synchronous setState is needed inside the effect */
  useEffect(() => {
    if (!challengeIn) return;
    const endAt = challengeIn.at + CHALLENGE_TTL_S * 1000;
    const iv = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setLeftSec(left);
      if (left <= 0) { clearInterval(iv); setChallengeIn(null); setAccepting(false); }
    }, 400);
    return () => clearInterval(iv);
  }, [challengeIn]);

  const dropSocket = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  };

  const cancelQueue = () => {
    socketRef.current?.emit('queue:leave');
    dropSocket();
    setSearching(false);
    setWaitingRoom(null);
    sfx.click();
  };

  const sendChallenge = (friendId: string) => {
    if (!presenceRef.current) { toast.error(t('error')); return; }
    presenceRef.current.emit('challenge:send', { toUserId: friendId });
  };

  const cancelChallenge = () => {
    presenceRef.current?.emit('challenge:cancel');
    setChallengeOut(null);
    sfx.click();
  };

  const acceptChallenge = () => {
    if (!challengeIn || !presenceRef.current) return;
    setAccepting(true);
    presenceRef.current.emit('challenge:accept', { id: challengeIn.id });
  };

  const declineChallenge = () => {
    if (!challengeIn) return;
    presenceRef.current?.emit('challenge:decline', { id: challengeIn.id });
    setChallengeIn(null);
    setAccepting(false);
    sfx.click();
  };

  const startOnline = (ranked: boolean, roomCode?: string) => {
    if (!user) { toast.error(t('e_guest_upgrade')); return; }
    if (socketRef.current) socketRef.current.disconnect();
    setJoinOpen(false);
    setSearching(roomCode === undefined);
    setWaitingRoom(null);
    // Gateway routing: the port MUST ride in the URL query (XTransformPort).
    // The httpOnly session cookie is forwarded automatically (same-origin).
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });
    socketRef.current = socket;
    attachGameHandlers(socket, true); // game socket: re-assert queue intent on reconnect

    socket.on('connect', () => {
      if (roomCode) socket.emit('room:join', { code: roomCode });
      else if (roomCode === '') socket.emit('room:create');
      else socket.emit('queue:join', { ranked });
    });
    // transient drops: re-assert the intent after reconnect (server dedups /
    // resumes an active room, so this is idempotent)
    socket.io.on('reconnect', () => {
      if (roomCode) socket.emit('room:join', { code: roomCode });
      else if (roomCode === '') socket.emit('room:create');
      else socket.emit('queue:join', { ranked });
    });
    socket.on('connect_error', () => { setSearching(false); setWaitingRoom(null); toast.error(t('connection_lost')); });
    socket.on('disconnect', () => { setSearching(false); setWaitingRoom(null); });

    socket.on('error', (d: { code?: string }) => {
      setSearching(false);
      setWaitingRoom(null);
      toast.error(d?.code === 'BANNED' ? t('e_banned') : d?.code === 'ROOM_NOT_FOUND' ? t('invalid_code') : t('error'));
    });

    socket.on('queued', () => { setSearching(true); toast.info(t('finding_opponent')); });
    socket.on('room:created', (d: { code: string }) => {
      navigator.clipboard?.writeText(d.code).catch(() => undefined);
      setWaitingRoom(d.code);
    });
  };

  /* local / ai start — socket cleanup handled by onExit / cancelQueue (ref reads stay out of render) */
  const startLocal = (mode: 'ai' | 'local') => {
    sfx.click();
    setOnlineHooks(null);
    setPhase('game');
  };

  const submitJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code)) { setJoinError(true); return; }
    setJoinError(false);
    startOnline(false, code);
  };

  if (phase === 'game') {
    return (
      <GameScreen
        mode={onlineHooks ? 'online' : gameSettings.mode === 'local' ? 'local' : 'ai'}
        aiLevel={gameSettings.aiLevel}
        boardId={gameSettings.boardId}
        customNumbers={onlineHooks ? undefined : customNumbers ?? undefined}
        online={onlineHooks ?? undefined}
        onlineState={onlineHooks ? onlineState : null}
        onlineRewards={onlineHooks ? onlineRewards : null}
        onExit={() => {
          socketRef.current?.disconnect();
          socketRef.current = null;
          setOnlineHooks(null);
          setOnlineState(null);
          setOnlineRewards(null);
          setPhase('lobby');
        }}
      />
    );
  }

  const cards: {
    key: string; title: string; desc: string; icon: React.ReactNode;
    onClick: () => void; disabled?: boolean; accent: string;
  }[] = [
    { key: 'easy', title: `${t('mode_ai')} — ${t('ai_easy')}`, desc: '★☆☆', icon: <Bot className="h-6 w-6" />, accent: 'from-emerald-600/30', onClick: () => { setGameSettings({ mode: 'ai', aiLevel: 'EASY' }); startLocal('ai'); } },
    { key: 'medium', title: `${t('mode_ai')} — ${t('ai_medium')}`, desc: '★★☆', icon: <Bot className="h-6 w-6" />, accent: 'from-amber-600/30', onClick: () => { setGameSettings({ mode: 'ai', aiLevel: 'MEDIUM' }); startLocal('ai'); } },
    { key: 'hard', title: `${t('mode_ai')} — ${t('ai_hard')}`, desc: '★★★', icon: <Crown className="h-6 w-6" />, accent: 'from-rose-600/30', onClick: () => { setGameSettings({ mode: 'ai', aiLevel: 'HARD' }); startLocal('ai'); } },
    { key: 'local', title: t('mode_local'), desc: t('duel_desc').slice(0, 40), icon: <Users className="h-6 w-6" />, accent: 'from-fuchsia-600/30', onClick: () => { setGameSettings({ mode: 'local' }); startLocal('local'); } },
  ];

  const canChallenge = !searching && !waitingRoom && !challengeOut && !challengeIn;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-8">
      <h1 className="mb-1 text-center text-2xl font-black"><span className="gold-text">{t('game_new')}</span></h1>
      <p className="mb-5 text-center text-xs text-muted-foreground">{t('tagline')}</p>

      {/* board selection */}
      <div className="royal-card mb-5 rounded-2xl p-4">
        <div className="mb-2 text-sm font-bold">{t('choose_board')}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BOARD_CATALOG.map((b) => (
            <button
              key={b.id}
              disabled={searching}
              onClick={() => { setGameSettings({ boardId: b.id }); setCustomNumbers(null); sfx.click(); }}
              className={`rounded-xl border p-2.5 text-center transition-all disabled:opacity-40 ${
                gameSettings.boardId === b.id ? 'border-amber-400 bg-amber-400/10 glow-gold' : 'border-border hover:border-amber-400/50'
              }`}
            >
              <MiniBoardPreview id={b.id} />
              <div className="mt-1 text-xs font-bold">
                {t(`board_${b.id}` as 'board_classic' | 'board_daily' | 'board_symmetry' | 'board_storm')}
              </div>
              {b.id === 'daily' && <div className="text-[9px] text-muted-foreground">{localizeDigits(new Date().toISOString().slice(5, 10).replace('-', '/'), locale)}</div>}
            </button>
          ))}
        </div>
        {gameSettings.boardId === 'daily' && <div className="mt-2 text-center text-[10px] text-muted-foreground">{t('daily_board_note')}</div>}

        {/* team designs strip — AI / local only. Online is hidden (not merely
         * disabled): the socket service engine cannot replay custom layouts yet. */}
        {!searching && !waitingRoom && teamBoards.length > 0 && (
          <div className="mt-4 border-t border-amber-400/15 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <Palette className="h-4 w-4 text-amber-400" /> {t('boards_team')}
            </div>
            <div className="text-[10px] text-muted-foreground">{t('boards_team_sub')}</div>
            <div className="nice-scroll mt-2 flex gap-2 overflow-x-auto pb-1">
              {teamBoards.map((b) => {
                const id = `c${b.code}`;
                const name = locale === 'fa' || locale === 'ar' ? (b.nameFa || b.nameEn) : (b.nameEn || b.nameFa);
                const active = gameSettings.boardId === id;
                return (
                  <button
                    key={b.code}
                    onClick={() => { setGameSettings({ boardId: id }); setCustomNumbers(layoutFromCustom(b.layout)); sfx.click(); }}
                    className={`w-24 shrink-0 rounded-xl border p-2 text-center transition-all ${
                      active ? 'border-amber-400 bg-amber-400/10 glow-gold' : 'border-border hover:border-amber-400/50'
                    }`}
                  >
                    <CustomMiniBoard layout={b.layout} />
                    <div className="mt-1 truncate text-xs font-bold" title={name}>{name}</div>
                    <div className="text-[9px] text-muted-foreground">▶ {localizeDigits(b.plays, locale)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* mode cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.key}
            disabled={searching}
            onClick={c.onClick}
            className={`royal-card group rounded-2xl bg-gradient-to-br ${c.accent} to-transparent p-4 text-start transition-all hover:scale-[1.02] hover:glow-purple disabled:pointer-events-none disabled:opacity-40`}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-black/30 p-2.5 text-amber-400">{c.icon}</div>
              <div>
                <div className="font-bold">{c.title}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* online section */}
      <div className="royal-card mt-4 rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2 font-bold"><Globe className="h-5 w-5 text-emerald-400" /> {t('online')}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button className="glow-gold" onClick={() => startOnline(true)} disabled={!user || searching}>
            <Crown className="h-4 w-4" /> {t('ranked')}
          </Button>
          <Button variant="secondary" onClick={() => startOnline(false)} disabled={!user || searching}>
            <Globe className="h-4 w-4" /> {t('casual')}
          </Button>
          <Button
            variant="outline"
            disabled={!user || searching}
            onClick={() => { setJoinCode(''); setJoinError(false); setJoinOpen(true); sfx.click(); }}
          >
            <LogIn className="h-4 w-4" /> {t('join_room')}
          </Button>
        </div>
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!user || searching || !!waitingRoom}
            onClick={() => startOnline(false, '')}
          >
            <Plus className="h-4 w-4" /> {t('create_room')}
          </Button>
        </div>
        {!user && <div className="mt-1 text-center text-xs text-rose-400">{t('e_guest_upgrade')}</div>}

        {searching || waitingRoom ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-4">
            <div className="relative h-16 w-16" aria-hidden>
              <span className="absolute inset-0 rounded-full border-2 border-amber-400/50 animate-ping" />
              <span className="absolute inset-0 rounded-full border-2 border-amber-400/35 animate-ping" style={{ animationDelay: '0.55s' }} />
              <span className="absolute inset-0 rounded-full border-2 border-amber-400/20 animate-ping" style={{ animationDelay: '1.1s' }} />
              <div className="absolute inset-2 flex items-center justify-center rounded-full bg-gradient-to-br from-amber-400/40 to-amber-700/30 text-amber-300">
                <Swords className="h-5 w-5" />
              </div>
            </div>
            {waitingRoom && (
              <button
                className="group flex items-center gap-2 rounded-lg border border-amber-400/40 bg-black/30 px-4 py-1.5 transition-colors hover:border-amber-400"
                onClick={() => { navigator.clipboard?.writeText(waitingRoom).catch(() => undefined); sfx.click(); toast.success(t('copied')); }}
                title={t('copied')}
              >
                <span className="font-mono text-xl font-black tracking-[0.3em] text-amber-300" dir="ltr">{waitingRoom}</span>
                <Copy className="h-4 w-4 text-muted-foreground group-hover:text-amber-300" />
              </button>
            )}
            <div className="text-xs font-black text-amber-300">{waitingRoom ? t('waiting_opponent') : t('finding_opponent')}</div>
            <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground" onClick={cancelQueue}>
              <X className="h-3.5 w-3.5" /> {t('cancel_queue')}
            </Button>
          </div>
        ) : presence ? (
          <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground" title={t('online')}>
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {localizeDigits(presence.players, locale)} {t('players_online')}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Swords className="h-3 w-3" /> {localizeDigits(presence.rooms, locale)} {t('live_duels')}
            </span>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('loading')}
          </div>
        )}
      </div>

      {/* friends */}
      <FriendsPanel
        canChallenge={canChallenge}
        challengeOutName={challengeOut?.name ?? null}
        onChallenge={sendChallenge}
        onCancelChallenge={cancelChallenge}
      />

      {/* join-by-code dialog */}
      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="sm:max-w-xs" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-amber-400" /> {t('join_room')}
            </DialogTitle>
            <DialogDescription>{t('join_code_hint')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value.toUpperCase().slice(0, 6)); setJoinError(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitJoin(); }}
            placeholder="XXXX"
            maxLength={6}
            dir="ltr"
            className={cn(
              'text-center font-mono text-xl font-black tracking-[0.4em]',
              joinError ? 'border-rose-500 focus-visible:ring-rose-500' : 'border-amber-400/50 focus-visible:ring-amber-400',
            )}
            aria-invalid={joinError}
          />
          {joinError && <p className="text-center text-xs font-bold text-rose-400">{t('invalid_code')}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>{t('cancel')}</Button>
            <Button className="glow-gold" onClick={submitJoin} disabled={!/^[A-Z0-9]{4,6}$/.test(joinCode.trim())}>
              <LogIn className="h-4 w-4" /> {t('join_action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* incoming friend-challenge dialog */}
      <Dialog open={!!challengeIn} onOpenChange={(o) => { if (!o && !accepting) declineChallenge(); }}>
        <DialogContent className="royal-card sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-center gold-text">
              <Zap className="h-5 w-5 text-amber-400" /> {t('challenge_incoming')}
            </DialogTitle>
            <DialogDescription className="text-center">{t('challenge_incoming_sub')}</DialogDescription>
          </DialogHeader>
          {challengeIn && (
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="relative">
                <span className="absolute -inset-3 rounded-full border-2 border-amber-400/50 animate-ping" aria-hidden />
                <span className="absolute -inset-3 rounded-full border-2 border-amber-400/25 animate-ping" style={{ animationDelay: '0.6s' }} aria-hidden />
                <AvatarBubble code={challengeIn.from.avatarItem} size={64} glow />
              </div>
              <div className="text-center">
                <div className="text-lg font-black" dir="auto">{challengeIn.from.username}</div>
                <div className="mt-0.5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                  <span>⭐ {t('level')} {localizeDigits(challengeIn.from.level, locale)}</span>
                  <span aria-hidden>·</span>
                  <span>🏆 {localizeDigits(challengeIn.from.rating, locale)}</span>
                </div>
              </div>
              {/* countdown bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="timer" aria-label={t('challenge_wait')}>
                <div
                  className={cn('h-full rounded-full transition-all duration-1000 ease-linear', leftSec > 8 ? 'bg-amber-400' : 'bg-rose-500')}
                  style={{ width: `${Math.max(0, (leftSec / CHALLENGE_TTL_S) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={declineChallenge} disabled={accepting}>{t('challenge_no')}</Button>
            <Button className="glow-gold" onClick={acceptChallenge} disabled={accepting}>
              {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
              {t('challenge_accept')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniBoardPreview({ id }: { id: string }) {
  const cols = 9, rows = 7;
  // deterministic mini-preview: hash id to cells
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
  const rnd = (n: number) => { const x = Math.sin(seed + n * 7919) * 10000; return x - Math.floor(x); };
  return (
    <div className="mx-auto grid w-full max-w-[90px] gap-[1px] rounded-md bg-amber-900/60 p-[3px]" style={{ gridTemplateColumns: `repeat(${cols},1fr)` }} aria-hidden>
      {Array.from({ length: cols * rows }, (_, i) => (
        <div key={i} className="aspect-square rounded-[1px]" style={{ background: rnd(i) > 0.14 ? '#e3b878' : 'transparent' }} />
      ))}
    </div>
  );
}

/** true-to-layout mini preview of a team-designed board (bottom-first array) */
function CustomMiniBoard({ layout }: { layout: number[] }) {
  const cols = 9, rows = 7;
  return (
    <div className="mx-auto grid w-full max-w-[90px] gap-[1px] rounded-md bg-amber-900/60 p-[3px]" style={{ gridTemplateColumns: `repeat(${cols},1fr)` }} aria-hidden>
      {Array.from({ length: cols * rows }, (_, i) => {
        // render top row first: flip the bottom-first array for display
        const r = Math.floor(i / cols);
        const c = i % cols;
        const v = layout[(rows - 1 - r) * cols + c] ?? 0;
        return <div key={i} className="aspect-square rounded-[1px]" style={{ background: v > 0 ? '#e3b878' : 'transparent' }} />;
      })}
    </div>
  );
}
