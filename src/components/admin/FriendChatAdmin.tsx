'use client';

/**
 * FriendChatAdmin — READ-ONLY supervision panel for friend-to-friend DMs (T9-c).
 * Self-contained; designed to be mounted by the orchestrator inside AdminView
 * (this file deliberately does not touch AdminView.tsx).
 *
 * Features: flagged-only switch, username search, recent-message feed with
 * badges + flagged-word chips + relative time, click-to-expand full pair
 * conversation, and a non-destructive "jump to user" hint for follow-up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Eye, Loader2, MessageSquareLock, RefreshCw, Search, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';

interface AdminMsg {
  id: string; from: string; to: string; body: string;
  masked: boolean; flagged: boolean; flaggedWords: string[];
  severity: number; readAt: string | null; createdAt: string;
}

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

export function FriendChatAdmin() {
  const { t, locale } = useApp();
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState(''); // committed search term
  const [rows, setRows] = useState<AdminMsg[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<AdminMsg | null>(null);
  const [thread, setThread] = useState<AdminMsg[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  const load = useCallback((flagged: boolean, user: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (flagged) params.set('flagged', '1');
    if (user.trim()) params.set('user', user.trim());
    api.get<{ messages: AdminMsg[] }>(`/api/admin/chat?${params.toString()}`)
      .then((d) => { if (liveRef.current) { setRows(d.messages); setLoading(false); } })
      .catch(() => { if (liveRef.current) { toast.error(t('error')); setLoading(false); } });
  }, [t]);

  useEffect(() => {
    load(flaggedOnly, applied);
  }, [load, flaggedOnly, applied]);

  /** event handlers set the spinner synchronously (lint-safe), effect just fetches */
  const refetch = (flagged: boolean, user: string) => { setLoading(true); load(flagged, user); };
  const commitSearch = (term: string) => {
    if (term !== applied) { setLoading(true); setApplied(term); }
  };

  const openThread = (m: AdminMsg) => {
    if (expanded?.id === m.id) { setExpanded(null); setThread(null); return; }
    setExpanded(m);
    setThread(null);
    setThreadLoading(true);
    api.get<{ messages: AdminMsg[] }>(`/api/admin/chat?thread=${encodeURIComponent(m.from)}|${encodeURIComponent(m.to)}`)
      .then((d) => { if (liveRef.current) setThread(d.messages); })
      .catch(() => { if (liveRef.current) toast.error(t('error')); })
      .finally(() => { if (liveRef.current) setThreadLoading(false); });
  };

  return (
    <div className="space-y-3">
      {/* header + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareLock className="h-5 w-5 text-amber-400" aria-hidden />
        <h3 className="text-sm font-black">{t('admin_chat_title')}</h3>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <Switch checked={flaggedOnly} onCheckedChange={(v) => { setLoading(true); setFlaggedOnly(v === true); }} aria-label={t('admin_chat_flagged_only')} />
            <ShieldAlert className={cn('h-3.5 w-3.5', flaggedOnly ? 'text-rose-400' : 'text-muted-foreground')} aria-hidden />
            {t('admin_chat_flagged_only')}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value.slice(0, 16))}
              onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(search); }}
              onBlur={() => commitSearch(search)}
              placeholder={t('admin_chat_search')}
              dir="ltr"
              className="h-8 w-44 ps-7 text-xs"
              aria-label={t('admin_chat_search')}
            />
          </div>
          <button
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-amber-400"
            onClick={() => { refetch(flaggedOnly, applied); sfx.click(); }}
            aria-label="refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* feed */}
      {!rows && loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-xs text-muted-foreground">
          {t('admin_chat_empty')}
        </div>
      ) : (
        <div className="nice-scroll max-h-[420px] space-y-1.5 overflow-y-auto pe-1">
          {(rows ?? []).map((m) => {
            const isOpen = expanded?.id === m.id;
            return (
              <div key={m.id} className={cn('overflow-hidden rounded-xl border transition-colors', isOpen ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/60 bg-black/10 hover:border-amber-500/25')}>
                <button
                  className="flex w-full items-start gap-2 p-2.5 text-start"
                  onClick={() => { openThread(m); sfx.click(); }}
                  aria-expanded={isOpen}
                >
                  <span className={cn('mt-0.5 shrink-0', m.flagged ? 'text-rose-400' : 'text-emerald-400')} aria-hidden>
                    {m.flagged ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1 text-[11px] font-black">
                      <span dir="ltr" className="text-amber-300">{m.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span dir="ltr" className="text-sky-300">{m.to}</span>
                      {m.masked && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-black text-amber-300">⚠ {t('chat_masked_tag')}</span>}
                      {m.flagged && <span className="rounded bg-rose-500/15 px-1 text-[9px] font-black text-rose-400">{t('admin_chat_flagged_only')}</span>}
                      <span className="ms-auto font-normal text-muted-foreground">{relTime(m.createdAt, locale)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-foreground/90" dir="auto">{m.body}</span>
                    {m.flaggedWords.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.flaggedWords.map((w) => (
                          <span key={w} dir="ltr" className="rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-300">
                            {w}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                </button>

                {/* expanded pair conversation */}
                {isOpen && (
                  <div className="border-t border-amber-500/20 bg-black/20 p-2.5">
                    {threadLoading ? (
                      <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('loading')}
                      </div>
                    ) : thread && thread.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">{t('admin_chat_empty')}</p>
                    ) : (
                      <div className="nice-scroll max-h-56 space-y-1.5 overflow-y-auto pe-1">
                        {(thread ?? []).map((tm) => (
                          <div key={tm.id} className="flex items-start gap-1.5 text-[11px]">
                            <span className={cn('mt-0.5 shrink-0 font-black', tm.from === m.from ? 'text-amber-300' : 'text-sky-300')} dir="ltr">
                              {tm.from === m.from ? tm.from : tm.to}
                            </span>
                            <span className={cn('min-w-0 flex-1 break-words rounded-lg px-2 py-1', tm.from === m.from ? 'bg-amber-500/10 text-foreground/90' : 'bg-white/5 text-foreground/80')} dir="auto">
                              {tm.body}
                              {tm.flaggedWords.length > 0 && <span className="ms-1 text-[9px] font-bold text-rose-300">⚠ {tm.flaggedWords.join(' · ')}</span>}
                            </span>
                            <span className="shrink-0 text-[9px] text-muted-foreground">{relTime(tm.createdAt, locale)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* non-destructive follow-up hint (v1: no actions, reads only) */}
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[10px] text-sky-200/90">
                      <UserRound className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">{t('admin_chat_jump')}</span>
                      <span dir="ltr" className="rounded bg-black/30 px-1.5 py-0.5 font-black">@{expanded.from}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* footer meta */}
      {rows && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Eye className="h-3 w-3" aria-hidden />
          {localizeDigits(rows.length, locale)} · {flaggedOnly ? t('admin_chat_flagged_only') : t('admin_chat_title')}
        </p>
      )}
    </div>
  );
}

