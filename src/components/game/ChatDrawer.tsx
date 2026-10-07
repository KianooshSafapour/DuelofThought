'use client';

/**
 * ChatDrawer — supervised friend-to-friend conversation (T9-c).
 * Opens from FriendsPanel; polls /api/chat?with=<friend> every 5s (after=
 * cursor), optimistic append for own sends, read receipts clear on open.
 * Moderation UI: masked messages carry a ⚠ badge; blocked sends shake the
 * composer with a localized toast. Supervision is disclosed under the header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits } from '@/lib/i18n';
import { AvatarBubble } from '@/components/shared/PixelSprite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import { Eye, Loader2, MessageCircleOff, Send, ShieldCheck, UserRoundX, X } from 'lucide-react';

export interface ChatDrawerFriend {
  username: string;
  avatarItem: string;
  level: number;
  online?: boolean;
  dueling?: boolean;
}

interface ChatMsg {
  id: string; from: string; body: string; masked: boolean; flagged: boolean;
  createdAt: string; readAt: string | null; pending?: boolean;
}

const MAX_BODY = 500;
const POLL_MS = 5000;

/** relative time via Intl.RelativeTimeFormat (fa → «۳ دقیقه پیش») */
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function relTime(iso: string, locale: string): string {
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
    if (!rtf) { rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }); rtfCache.set(locale, rtf); }
    return rtf.format(Math.round(diff / div), unit);
  } catch { return '—'; }
}

function mergeMsgs(prev: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  if (incoming.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const merged = [...prev];
  for (const m of incoming) if (!seen.has(m.id)) merged.push(m);
  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return merged;
}

export function ChatDrawer({
  friend,
  onClose,
  onRead,
}: {
  friend: ChatDrawerFriend;
  onClose: () => void;
  onRead?: () => void;
}) {
  const { t, locale, user } = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [mini, setMini] = useState<{ avatarItem: string; level: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFriend, setNotFriend] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [shake, setShake] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const lastAtRef = useRef<string | null>(null);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  const meName = user?.username ?? '';

  const consumeRead = useCallback((markedRead: number) => {
    if (markedRead > 0) onRead?.();
  }, [onRead]);

  /* ------------------------- initial load ------------------------- */
  useEffect(() => {
    if (!user) return;
    let url = `/api/chat?with=${encodeURIComponent(friend.username)}`;
    api.get<{ friend: { avatarItem: string; level: number }; markedRead: number; messages: ChatMsg[] }>(url)
      .then((d) => {
        if (!liveRef.current) return;
        setMini({ avatarItem: d.friend.avatarItem, level: d.friend.level });
        setMessages((prev) => mergeMsgs(prev, d.messages));
        lastAtRef.current = d.messages.length ? d.messages[d.messages.length - 1].createdAt : lastAtRef.current;
        consumeRead(d.markedRead);
        setLoading(false);
      })
      .catch((e) => {
        if (!liveRef.current) return;
        const code = (e as Error).message;
        if (code === 'NOT_FRIEND') setNotFriend(true);
        else toast.error(t('error'));
        setLoading(false);
      });
  }, [friend.username]);

  /* --------------------- 5s incremental polling -------------------- */
  const poll = useCallback(() => {
    if (!user || notFriend) return;
    const after = lastAtRef.current;
    const url = `/api/chat?with=${encodeURIComponent(friend.username)}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    api.get<{ markedRead: number; messages: ChatMsg[] }>(url)
      .then((d) => {
        if (!liveRef.current) return;
        if (d.messages.length) {
          setMessages((prev) => {
            const merged = mergeMsgs(prev, d.messages);
            lastAtRef.current = merged.length ? merged[merged.length - 1].createdAt : lastAtRef.current;
            return merged;
          });
          sfx.chat();
        }
        consumeRead(d.markedRead);
      })
      .catch(() => undefined);
  }, [user, notFriend, friend.username, consumeRead]);

  useEffect(() => {
    if (!user || !mini || notFriend) return;
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [user, mini, notFriend, poll]);

  /* ------------------------- auto-scroll -------------------------- */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 30 ? 'auto' : 'smooth' });
  }, [messages.length, loading]);

  /* --------------------------- send ------------------------------- */
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !user) return;
    setSending(true);
    const tempId = `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: ChatMsg = {
      id: tempId, from: meName, body: text, masked: false, flagged: false,
      createdAt: new Date().toISOString(), readAt: null, pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    try {
      const res = await api.post<{ ok: boolean; message: ChatMsg }>('/api/chat', { to: friend.username, body: text });
      if (liveRef.current) {
        setMessages((prev) => {
          const next = prev.map((m) => (m.id === tempId ? res.message : m));
          lastAtRef.current = next.length ? next[next.length - 1].createdAt : lastAtRef.current;
          return next;
        });
      }
      sfx.chat();
    } catch (e) {
      if (liveRef.current) setMessages((prev) => prev.filter((m) => m.id !== tempId));
      const code = (e as Error).message;
      if (code === 'CHAT_BLOCKED') {
        toast.error(t('chat_blocked_msg'));
        setShake(true);
        window.setTimeout(() => setShake(false), 450);
        sfx.bad();
      } else if (code === 'RATE') {
        toast.error(t('chat_rate'));
      } else if (code === 'NOT_FRIEND') {
        setNotFriend(true);
      } else {
        toast.error(t('error'));
      }
      setDraft(text); // restore draft so nothing is lost
    } finally {
      if (liveRef.current) setSending(false);
    }
  }, [draft, sending, user, meName, friend.username, t]);

  /* ------------------------- escape to close ----------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const avatar = mini?.avatarItem ?? friend.avatarItem;
  const level = mini?.level ?? friend.level;

  const presence = useMemo(() => {
    if (friend.dueling) return { cls: 'bg-amber-500', ping: true };
    if (friend.online) return { cls: 'bg-emerald-500', ping: true };
    return { cls: 'bg-zinc-600', ping: false };
  }, [friend.online, friend.dueling]);

  /* ------------------------- locked states ------------------------- */
  if (!user) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="royal-card relative flex h-[min(420px,70dvh)] w-full flex-col items-center justify-center gap-3 rounded-t-3xl p-6 text-center sm:h-auto sm:max-w-md sm:rounded-3xl">
          <MessageCircleOff className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-bold">🔒 {t('chat_guest_lock')}</p>
          <Button size="sm" variant="outline" onClick={onClose}>{t('close')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal aria-label={t('chat_drawer_title')}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="royal-card relative flex h-[min(620px,88dvh)] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:h-[min(560px,82dvh)] sm:max-w-md sm:rounded-3xl">

        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-border/60 bg-black/20 p-3">
          <span className="relative shrink-0" aria-hidden>
            <AvatarBubble code={avatar} size={36} glow={presence.cls !== 'bg-zinc-600'} />
            <span className={cn(
              'absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-background',
              presence.cls,
            )}>
              {presence.ping && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', presence.cls)} />}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black" dir="auto">{friend.username}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>⭐{localizeDigits(level, locale)}</span>
              {friend.dueling ? <span className="font-bold text-amber-400">🎮</span>
                : friend.online ? <span className="font-bold text-emerald-400">●</span>
                : <span>○</span>}
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => { onClose(); sfx.click(); }}
            aria-label={t('chat_close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* supervision disclosure — transparency is on-brand */}
        <div className="flex items-center justify-center gap-1.5 border-b border-amber-500/15 bg-amber-500/5 px-3 py-1.5 text-[10px] font-bold text-amber-300/90">
          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
          <span>{t('chat_supervised_note')}</span>
          <Eye className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
        </div>

        {/* messages */}
        <div ref={listRef} className="nice-scroll flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          ) : notFriend ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <UserRoundX className="h-8 w-8 text-rose-400" />
              <p className="text-xs font-bold text-muted-foreground">{t('chat_not_friend')}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              💬 {t('chat_empty')}
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.from === meName;
              return (
                <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <div
                    dir="auto"
                    className={cn(
                      'max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed shadow-sm',
                      mine
                        ? 'rounded-ee-md bg-gradient-to-br from-amber-500 to-amber-600 font-bold text-white'
                        : 'rounded-es-md border border-border/60 bg-muted/70 text-foreground',
                      m.pending && 'opacity-60',
                    )}
                  >
                    {m.body}
                    {m.masked && !m.pending && (
                      <span
                        className="ms-1.5 inline-flex items-center rounded bg-black/25 px-1 align-middle text-[9px] font-black text-amber-200"
                        title={t('chat_flagged_note')}
                        aria-label={t('chat_flagged_note')}
                      >
                        ⚠ {t('chat_masked_tag')}
                      </span>
                    )}
                  </div>
                  <span className={cn('mt-0.5 px-1 text-[9px] text-muted-foreground', mine && 'text-end')}>
                    {relTime(m.createdAt, locale)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* composer */}
        <div className={cn('border-t border-border/60 bg-black/20 p-2.5', shake && 'animate-shake')}>
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              placeholder={t('chat_placeholder_dm')}
              disabled={loading || notFriend || sending}
              maxLength={MAX_BODY}
              dir="auto"
              className="h-10 flex-1"
              aria-label={t('chat_placeholder_dm')}
            />
            <Button
              size="sm"
              className="h-10 glow-gold px-3"
              disabled={loading || notFriend || sending || draft.trim().length === 0}
              onClick={() => { void send(); }}
              aria-label={t('chat_send')}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
              <span className="hidden sm:inline">{t('chat_send')}</span>
            </Button>
          </div>
          <div className="mt-1 flex justify-end pe-1">
            <span className={cn('text-[9px] tabular-nums', draft.length > MAX_BODY - 50 ? 'text-amber-400' : 'text-muted-foreground/70')}>
              {localizeDigits(`${draft.length}/${MAX_BODY}`, locale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
