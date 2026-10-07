'use client';

/**
 * FriendsPanel — social hub of the lobby: add/remove friends, accept incoming
 * requests, see live presence, and challenge online friends to a friendly duel.
 * REST CRUD via /api/friends; realtime challenges ride the lobby socket (PlayView).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { localizeDigits } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { sfx } from '@/lib/sound';
import { UserRoundPlus, Swords, X, Check, Clock, RefreshCw, Hourglass, Loader2, UserX, MessageCircle } from 'lucide-react';
import { ChatDrawer } from '@/components/game/ChatDrawer';

interface FriendRow {
  id: string; username: string; avatarItem: string; titleItem: string | null;
  level: number; rating: number; wins: number; gamesPlayed: number;
  online: boolean; dueling: boolean; queuing: boolean; suspended: boolean; lastSeen: string;
}
interface ReqRow { id: string; from: MiniUser }
interface OutRow { id: string; to: MiniUser }
interface MiniUser { id: string; username: string; avatarItem: string; level: number; rating: number }
interface FriendsData { friends: FriendRow[]; incoming: ReqRow[]; outgoing: OutRow[] }
interface ChatThreadDTO { friend: { id: string; username: string; avatarItem: string; level: number }; unread: number; last: { fromId: string; body: string; masked: boolean; createdAt: string } | null }

export function FriendsPanel({
  canChallenge,
  challengeOutName,
  onChallenge,
  onCancelChallenge,
}: {
  canChallenge: boolean;
  challengeOutName: string | null;
  onChallenge: (friendId: string) => void;
  onCancelChallenge: () => void;
}) {
  const { t, locale, user } = useApp();
  const [data, setData] = useState<FriendsData | null>(null);
  const [addName, setAddName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<FriendRow | null>(null);
  const [chatWith, setChatWith] = useState<FriendRow | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const liveRef = useRef(true);
  liveRef.current = true;

  const load = useCallback(() => {
    if (!user) { setData(null); return; }
    api.get<FriendsData>('/api/friends')
      .then((d) => { if (liveRef.current) setData(d); })
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const id = setInterval(load, 15_000);
    return () => { liveRef.current = false; clearInterval(id); };
  }, [load, user]);

  /* lightweight unread poll (friend-chat, T9-c): thread list every 30s */
  const loadUnread = useCallback(() => {
    if (!user) { setUnread({}); return; }
    api.get<{ threads: ChatThreadDTO[] }>('/api/chat')
      .then((d) => {
        if (!liveRef.current) return;
        const map: Record<string, number> = {};
        for (const th of d.threads) if (th.unread > 0) map[th.friend.id] = th.unread;
        setUnread(map);
      })
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    loadUnread();
    if (!user) return;
    const id = setInterval(loadUnread, 30_000);
    return () => clearInterval(id);
  }, [loadUnread, user]);

  const act = async (body: Record<string, string>, okMsg?: string) => {
    setBusy(true);
    try {
      await api.post('/api/friends', body);
      if (okMsg) { sfx.coin(); toast.success(okMsg); }
      load();
      return true;
    } catch (e) {
      const code = (e as Error).message;
      const map: Record<string, string> = {
        NOT_FOUND: t('e_fr_notfound'),
        SELF: t('e_fr_self'),
        ALREADY: t('e_fr_already'),
        PENDING: t('e_fr_pending'),
        LIMIT: t('e_fr_limit'),
        GUEST: t('e_fr_guest'),
        RATE: t('e_rate'),
      };
      toast.error(map[code] ?? t('error'));
      if (code !== 'RATE') load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="royal-card mt-4 rounded-2xl p-4 text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-sm font-bold"><UserRoundPlus className="h-4 w-4 text-amber-400" /> {t('friends')}</div>
        <p className="text-xs text-muted-foreground">🤝 {t('e_fr_guest')}</p>
      </div>
    );
  }

  const friends = data?.friends ?? [];
  const onlineCount = friends.filter((f) => f.online).length;

  return (
    <div className="royal-card mt-4 rounded-2xl p-4">
      {/* header */}
      <div className="mb-3 flex items-center gap-2">
        <UserRoundPlus className="h-5 w-5 text-amber-400" />
        <span className="font-bold">{t('friends')}</span>
        {data && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-400">
            <span className="relative me-1 inline-flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {localizeDigits(onlineCount, locale)}/{localizeDigits(friends.length, locale)}
          </span>
        )}
        <button
          className="ms-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-amber-400"
          onClick={() => { load(); sfx.click(); }}
          aria-label="refresh friends"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', !data && 'animate-spin')} />
        </button>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{t('friends_sub')}</p>

      {/* add row */}
      <div className="mb-3 flex gap-2">
        <Input
          value={addName}
          onChange={(e) => setAddName(e.target.value.slice(0, 16))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addName.trim().length >= 3 && !busy) {
              void act({ action: 'add', username: addName.trim() }, `${t('add_friend')} ✓`).then((ok) => { if (ok) setAddName(''); });
            }
          }}
          placeholder={t('add_friend_hint')}
          maxLength={16}
          dir="ltr"
          className="h-9 flex-1 text-start"
          aria-label={t('add_friend')}
        />
        <Button
          size="sm"
          className="h-9 glow-gold"
          disabled={busy || addName.trim().length < 3}
          onClick={() => { void act({ action: 'add', username: addName.trim() }, `${t('add_friend')} ✓`).then((ok) => { if (ok) setAddName(''); }); }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundPlus className="h-4 w-4" />}
          <span className="hidden sm:inline">{t('add_friend')}</span>
        </Button>
      </div>

      {/* incoming requests */}
      {!!data?.incoming.length && (
        <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="mb-1.5 text-[11px] font-black text-emerald-400">📬 {t('incoming_req')} ({localizeDigits(data.incoming.length, locale)})</div>
          <div className="space-y-1.5">
            {data.incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg bg-black/20 p-1.5">
                <AvatarBubble code={r.from.avatarItem} size={26} />
                <span className="flex-1 truncate text-xs font-bold">{r.from.username}</span>
                <span className="hidden text-[10px] text-muted-foreground sm:inline">⭐{localizeDigits(r.from.level, locale)} · {localizeDigits(r.from.rating, locale)}</span>
                <Button size="sm" className="h-7 px-2" disabled={busy} onClick={() => { void act({ action: 'accept', id: r.id }, `${t('accept')} ✓`); }}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-rose-400" disabled={busy} onClick={() => { void act({ action: 'decline', id: r.id }); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* outgoing pending */}
      {!!data?.outgoing.length && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-muted-foreground">{t('outgoing_req')}:</span>
          {data.outgoing.map((r) => (
            <button
              key={r.id}
              disabled={busy}
              onClick={() => { void act({ action: 'cancel', id: r.id }); }}
              className="group flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/5 px-2 py-0.5 text-[10px] font-bold text-amber-300/90 transition-colors hover:border-rose-500/50 hover:text-rose-400"
              title={t('cancel_req')}
            >
              <Hourglass className="h-3 w-3" /> {r.to.username}
              <X className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      {/* friends list */}
      {!data ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</div>
      ) : friends.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-500/20 py-5 text-center text-xs text-muted-foreground">🤝 {t('no_friends')}</div>
      ) : (
        <div className="nice-scroll max-h-64 space-y-1.5 overflow-y-auto pe-1">
          {friends.map((f, rowIdx) => {
            const challenging = challengeOutName === f.username;
            return (
              <div
                key={f.id}
                className={cn(
                  'row-enter flex items-center gap-2 rounded-xl border p-2 transition-all',
                  f.dueling ? 'border-amber-500/35 bg-amber-500/5 hover:border-amber-500/55'
                    : f.online ? 'border-emerald-500/25 bg-emerald-500/5 hover:border-emerald-500/40'
                    : 'border-border/60 bg-black/10 opacity-70 hover:opacity-100',
                )}
                style={{ '--row-delay': `${Math.min(rowIdx * 40, 400)}ms` } as React.CSSProperties}
              >
                <span className="relative shrink-0" aria-hidden>
                  <AvatarBubble code={f.avatarItem} size={30} glow={f.online} />
                  <span className={cn(
                    'absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-background',
                    f.dueling ? 'bg-amber-500' : f.online ? 'bg-emerald-500' : 'bg-zinc-600',
                  )} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-black">{f.username}</span>
                    {f.suspended && <span className="rounded bg-rose-500/20 px-1 text-[8px] font-black text-rose-400">⛔</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                    {f.dueling ? (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-400">
                        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                        </span>
                        🎮 {t('fr_dueling')}
                      </span>
                    ) : f.queuing ? (
                      <span className="font-bold text-sky-300">🔎 {t('fr_queuing')}</span>
                    ) : f.online ? (
                      <span className="font-bold text-emerald-400">● {t('fr_online')}</span>
                    ) : (
                      <span>○ {t('fr_offline')}</span>
                    )}
                    <span>⭐{localizeDigits(f.level, locale)}</span>
                    <span>🏆{localizeDigits(f.rating, locale)}</span>
                    <span className="hidden sm:inline">{localizeDigits(f.wins, locale)}{t('wins')}</span>
                  </div>
                </div>
                {/* friend chat (T9-c) — supervised DMs */}
                <button
                  className="relative shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-400"
                  onClick={() => { setChatWith(f); sfx.click(); }}
                  aria-label={`${t('chat_to_friend')} ${f.username}`}
                  title={t('chat_drawer_title')}
                >
                  <MessageCircle className="h-4 w-4" />
                  {(unread[f.id] ?? 0) > 0 && (
                    <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[8px] font-black text-black shadow">
                      {localizeDigits(unread[f.id], locale)}
                    </span>
                  )}
                </button>
                {challenging ? (
                  <Button size="sm" variant="outline" className="h-8 border-amber-400/40 px-2 text-[10px] text-amber-300" onClick={onCancelChallenge}>
                    <Clock className="h-3.5 w-3.5 animate-pulse" /> {t('challenge_wait')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 glow-gold px-2.5"
                    disabled={!f.online || f.dueling || !canChallenge || busy}
                    title={f.dueling ? t('fr_dueling') : f.online ? t('challenge') : t('challenge_gone_toast')}
                    onClick={() => { onChallenge(f.id); sfx.click(); }}
                  >
                    <Swords className="h-3.5 w-3.5" />
                    <span className="hidden text-[10px] md:inline">{t('challenge')}</span>
                  </Button>
                )}
                <button
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  onClick={() => { setRemoveTarget(f); sfx.click(); }}
                  aria-label={`${t('remove_friend')} ${f.username}`}
                  title={t('remove_friend')}
                >
                  <UserX className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* remove confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>💔 {t('remove_friend')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remove_friend_confirm')} <b dir="auto">{removeTarget?.username}</b>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRemoveTarget(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => { if (removeTarget) void act({ action: 'remove', friendId: removeTarget.id }); setRemoveTarget(null); }}
            >
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* supervised friend chat drawer (T9-c) */}
      {chatWith && (
        <ChatDrawer
          friend={{ username: chatWith.username, avatarItem: chatWith.avatarItem, level: chatWith.level, online: chatWith.online, dueling: chatWith.dueling }}
          onClose={() => { setChatWith(null); loadUnread(); }}
          onRead={loadUnread}
        />
      )}
    </div>
  );
}
