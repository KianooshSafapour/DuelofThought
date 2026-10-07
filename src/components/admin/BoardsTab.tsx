'use client';

/**
 * BoardsTab — developer Board Designer for the flagship "Duel of Thought"
 * game (task T9-b). Mounted as the «جدول‌ها · Boards» tab in AdminView.
 *
 * Left: interactive 9×7 grid editor (row 0 = BOTTOM row, exactly like the
 * engine layout). Click cycles blank → 1…9 → blank; right-click or a ~450ms
 * long-press cycles backwards. Live soundness panel mirrors boardIsSound()
 * so an unsound design can never reach the DB.
 * Right: board list (GET /api/admin/boards) with publish toggles, plays,
 * author and one-click edit. Playtest hands the board to the real play
 * lobby (useApp → view 'play') with the custom layout registered in the
 * module-level custom-board cache.
 *
 * Strings follow the admin-tab convention: bilingual inline fa · en.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits } from '@/lib/i18n';
import { toast } from 'sonner';
import { CLASSIC_BOARD, boardIsSound, setCustomBoards } from '@/lib/game/boards';
import { COLS, ROWS, TOTAL } from '@/lib/game/engine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LayoutGrid, Wand2, Eraser, Save, Pencil, Play, Trash2, RefreshCw, Check, X, Sparkles,
} from 'lucide-react';
import { sfx } from '@/lib/sound';
import { cn } from '@/lib/utils';

/* --------------------------------- types --------------------------------- */

interface AdminBoardRow {
  id: string;
  code: string;
  nameFa: string;
  nameEn: string;
  layout: number[]; // wire format: 63 ints 0..9 (0 = blank), bottom-first
  published: boolean;
  plays: number;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

const CODE_RE = /^[a-z0-9-]{3,24}$/;
const MIN_PER_NUMBER = 4;

const newCode = () => `b-${Math.random().toString(36).slice(2, 8)}`;
const toWire = (cells: (number | null)[]) => cells.map((v) => (v === null ? 0 : v));

/** minimal row shape used when the editor deletes a board before the list fetch resolves */
const blankRow = {
  id: '', nameFa: '', nameEn: '', layout: [], published: false, plays: 0,
  author: null as string | null, createdAt: '', updatedAt: '',
};

/* ------------------------------- component ------------------------------- */

export function BoardsTab() {
  const { locale } = useApp();
  const fmt = (n: number) => localizeDigits(n, locale);

  /* list */
  const [list, setList] = useState<AdminBoardRow[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await api.get<{ boards: AdminBoardRow[] }>('/api/admin/boards');
      setList(data.boards);
    } catch {
      toast.error('دریافت جدول‌ها ناموفق بود · Failed to load boards');
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => { void refreshList(); }, [refreshList]);

  /* editor — cells are engine-format (null = blank), bottom-first */
  const [code, setCode] = useState('');
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [published, setPublished] = useState(false);
  const [cells, setCells] = useState<(number | null)[]>(() => Array(TOTAL).fill(null));
  const [editingCode, setEditingCode] = useState<string | null>(null); // null = unsaved draft
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<AdminBoardRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* live soundness (same rule as the server) */
  const stats = useMemo(() => {
    const count: number[] = new Array(10).fill(0);
    let blanks = 0;
    for (const v of cells) { if (v === null) blanks++; else count[v]++; }
    const sound = boardIsSound(cells);
    return { count, blanks, sound, filled: TOTAL - blanks };
  }, [cells]);

  const codeOk = CODE_RE.test(code);
  const canSave = codeOk && stats.sound && !saving;

  /* -------- cell painting: click forward, right-click / hold backward ------- */
  const cycleCell = (idx: number, dir: 1 | -1) => {
    setCells((prev) => {
      const next = prev.slice();
      const cur = prev[idx] ?? 0; // null → 0
      let v = cur + dir;
      if (v > 9) v = 0;
      if (v < 0) v = 9;
      next[idx] = v === 0 ? null : v;
      return next;
    });
  };

  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);
  const clearLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const onCellDown = (idx: number) => {
    lpFired.current = false;
    clearLp();
    lpTimer.current = setTimeout(() => { lpFired.current = true; cycleCell(idx, -1); sfx.click(); }, 450);
  };

  const errToast = (e: unknown, fallback = 'خطا · Error') => {
    const msg = (e as Error).message;
    if (msg === 'DUP_CODE') toast.error('این کد قبلاً ثبت شده است · This code is already taken');
    else if (msg === 'NOT_SOUND') toast.error('جدول سالم نیست · Board is not sound');
    else if (msg === 'NOT_FOUND') { toast.error('جدول پیدا نشد · Board not found'); void refreshList(); }
    else toast.error(fallback);
  };

  /* -------- actions -------- */
  const loadClassic = () => { setCells([...CLASSIC_BOARD]); sfx.click(); };
  const clearAll = () => { setCells(Array(TOTAL).fill(null)); sfx.click(); };
  const startNew = () => {
    setCode(newCode()); setNameFa(''); setNameEn(''); setPublished(false);
    setCells(Array(TOTAL).fill(null)); setEditingCode(null); sfx.click();
  };
  const loadBoard = (b: AdminBoardRow) => {
    setCode(b.code); setNameFa(b.nameFa); setNameEn(b.nameEn); setPublished(b.published);
    setCells(b.layout.map((v) => (v === 0 ? null : v)));
    setEditingCode(b.code); sfx.click();
  };

  const saveNew = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.post('/api/admin/boards', {
        code, nameFa: nameFa.trim(), nameEn: nameEn.trim(), layout: toWire(cells), published,
      });
      toast.success('جدول ذخیره شد · Board created');
      setEditingCode(code);
      setCustomBoards([{ code, layout: toWire(cells) }]);
      await refreshList();
    } catch (e) { errToast(e, 'ذخیره ناموفق · Save failed'); }
    finally { setSaving(false); }
  };

  const saveChanges = async () => {
    if (!canSave || !editingCode) return;
    setSaving(true);
    try {
      await api.patch('/api/admin/boards', {
        code, nameFa: nameFa.trim(), nameEn: nameEn.trim(), layout: toWire(cells), published,
      });
      toast.success('تغییرات ذخیره شد · Changes saved');
      setCustomBoards([{ code, layout: toWire(cells) }]);
      await refreshList();
    } catch (e) { errToast(e, 'ذخیره ناموفق · Save failed'); }
    finally { setSaving(false); }
  };

  const togglePublish = async (bcode: string, current: boolean, next: boolean) => {
    /* optimistic — revert on failure (also mirrors into the open editor) */
    setList((prev) => (prev ? prev.map((r) => (r.code === bcode ? { ...r, published: next } : r)) : prev));
    if (editingCode === bcode) setPublished(next);
    try {
      await api.patch('/api/admin/boards', { code: bcode, published: next });
      toast.success(next ? 'منتشر شد · Published' : 'از انتشار خارج شد · Unpublished');
      sfx.coin();
    } catch {
      setList((prev) => (prev ? prev.map((r) => (r.code === bcode ? { ...r, published: current } : r)) : prev));
      if (editingCode === bcode) setPublished(current);
      toast.error('تغییر انتشار ناموفق بود · Publish toggle failed');
    }
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/admin/boards?code=${encodeURIComponent(delTarget.code)}`);
      toast.success('جدول حذف شد · Board deleted');
      if (editingCode === delTarget.code) setEditingCode(null);
      await refreshList();
    } catch { errToast(new Error('X'), 'حذف ناموفق · Delete failed'); }
    finally { setDeleting(false); setDelTarget(null); }
  };

  /** hand the current design to the real play lobby (AI mode) — the custom
   * layout is registered in the module cache so GameScreen/engine see it */
  const playtest = () => {
    if (!codeOk) { toast.error('کد نامعتبر · Invalid code'); return; }
    setCustomBoards([{ code, layout: toWire(cells) }]);
    useApp.getState().setGameSettings({ boardId: `c${code}`, mode: 'ai', aiLevel: 'EASY' });
    useApp.getState().setView('play');
    toast.info(stats.sound
      ? 'آزمایش جدول در حالت مقابل هوش مصنوعی · Playtesting vs AI'
      : 'آزمایش جدول ناسالم (ذخیره غیرفعال) · Playtesting an unsound draft (save disabled)');
  };

  /* ------------------------------- rendering ------------------------------- */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-amber-400" aria-hidden />
        <h2 className="text-sm font-black">طراح جدول · Board Designer</h2>
        <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-300">
          ۹×۷ = {fmt(63)} خانه · cells
        </Badge>
        <span className="ms-auto" />
        <Button variant="ghost" size="sm" onClick={() => void refreshList()} disabled={listLoading} aria-label="refresh boards">
          <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        {/* ------------------------------ editor ------------------------------ */}
        <div className="royal-card space-y-3 rounded-2xl p-4">
          {/* meta */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-[10px] font-bold text-muted-foreground">کد یکتا · code</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24))}
                dir="ltr"
                className={cn('font-mono text-xs', code && !codeOk && 'border-rose-500 focus-visible:ring-rose-500')}
                placeholder="b-x7k2p9"
                aria-invalid={!!code && !codeOk}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold text-muted-foreground">نام (فارسی) · nameFa</label>
              <Input value={nameFa} onChange={(e) => setNameFa(e.target.value.slice(0, 40))} className="text-xs" placeholder="تنگهٔ اعداد" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold text-muted-foreground">نام (انگلیسی) · nameEn</label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value.slice(0, 40))} dir="ltr" className="text-xs" placeholder="Number Strait" />
            </div>
          </div>

          {/* grid — display row 6 on top … row 0 (BOTTOM) at the bottom */}
          <div>
            <div className="mb-1 text-center text-[9px] font-bold tracking-widest text-muted-foreground">بالا · TOP</div>
            <div
              className="mx-auto grid w-full max-w-[420px] gap-[3px] rounded-xl border border-amber-500/30 bg-amber-950/40 p-1.5 shadow-inner"
              style={{ gridTemplateColumns: `repeat(${COLS},1fr)` }}
              role="grid"
              aria-label="board editor grid"
            >
              {Array.from({ length: ROWS }, (_, dispRow) => ROWS - 1 - dispRow).map((row) =>
                Array.from({ length: COLS }, (_, col) => {
                  const idx = row * COLS + col;
                  const v = cells[idx];
                  return (
                    <button
                      key={idx}
                      type="button"
                      role="gridcell"
                      aria-label={`row ${row + 1} col ${col + 1}: ${v ?? 'blank'}`}
                      onContextMenu={(e) => { e.preventDefault(); cycleCell(idx, -1); }}
                      onPointerDown={() => onCellDown(idx)}
                      onPointerUp={clearLp}
                      onPointerLeave={clearLp}
                      onClick={() => { if (lpFired.current) { lpFired.current = false; return; } cycleCell(idx, 1); }}
                      className={cn(
                        'flex aspect-square items-center justify-center rounded-md border text-[13px] font-black tabular-nums transition-colors select-none',
                        v !== null
                          ? 'border-amber-300/70 bg-gradient-to-br from-amber-100 to-amber-300 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,.4)] hover:from-amber-50 hover:to-amber-200'
                          : 'border-dashed border-white/15 bg-black/25 text-transparent hover:bg-black/10',
                      )}
                    >
                      {v !== null ? localizeDigits(v, locale) : '·'}
                    </button>
                  );
                }),
              )}
            </div>
            <div className="mt-1 text-center text-[9px] font-bold tracking-widest text-muted-foreground">پایین · BOTTOM (ردیف ۱)</div>
            <div className="mt-1 text-center text-[9px] text-muted-foreground">
              کلیک: ۱+ · راست‌کلیک / نگه‌داشتن: ۱− · click: +1, right-click / hold: −1
            </div>
          </div>

          {/* live soundness panel */}
          <div className={cn('rounded-xl border p-3', stats.sound ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold">
              <Sparkles className={cn('h-4 w-4', stats.sound ? 'text-emerald-400' : 'text-rose-400')} aria-hidden />
              سلامت جدول · Board soundness
              {stats.sound ? (
                <Badge className="border-transparent bg-emerald-500/20 text-[10px] text-emerald-300">سالم · sound</Badge>
              ) : (
                <Badge className="border-transparent bg-rose-500/20 text-[10px] text-rose-300">ناسالم · unsound</Badge>
              )}
              <span className="ms-auto text-[10px] font-normal text-muted-foreground">
                خالی · blanks: {fmt(stats.blanks)} · پر · filled: {fmt(stats.filled)}/{fmt(TOTAL)}
              </span>
            </div>
            <div className="grid grid-cols-9 gap-1">
              {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
                const ok = stats.count[n] >= MIN_PER_NUMBER;
                return (
                  <div
                    key={n}
                    title={`${n}: ${stats.count[n]}/${MIN_PER_NUMBER}`}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-lg border py-1 text-center',
                      ok ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-rose-400/40 bg-rose-400/10',
                    )}
                  >
                    <span className="text-xs font-black text-amber-300">{localizeDigits(n, locale)}</span>
                    <span className="text-[10px] font-bold tabular-nums">{fmt(stats.count[n])}</span>
                    <span aria-hidden>{ok ? <Check className="h-3 w-3 text-emerald-400" /> : <X className="h-3 w-3 text-rose-400" />}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
              هر عدد ۱ تا ۹ دست‌کم {fmt(MIN_PER_NUMBER)} بار · every number 1–9 needs ≥ {fmt(MIN_PER_NUMBER)} copies
            </p>
            {!stats.sound && (
              <p className="mt-1 rounded-lg bg-rose-500/10 p-2 text-center text-[11px] font-bold text-rose-300">
                ⚠ این جدول «سالم» نیست تا زمانی که کامل شود ذخیره غیرفعال است · Board is unsound — saving is disabled until fixed
              </p>
            )}
          </div>

          {/* publish + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5', published ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-border')}>
              <Switch checked={published} onCheckedChange={(v) => { if (!editingCode) { setPublished(v); return; } void togglePublish(code, published, v); }} aria-label="publish" />
              <span className="text-[11px] font-bold">{published ? 'منتشرشده · Published' : 'پیش‌نویس · Draft'}</span>
            </div>
            <span className="ms-auto" />
            {!editingCode ? (
              <Button className="glow-gold" size="sm" onClick={() => void saveNew()} disabled={!canSave}>
                <Save className="h-4 w-4" /> ذخیره · Save
              </Button>
            ) : (
              <Button className="glow-gold" size="sm" onClick={() => void saveChanges()} disabled={!canSave}>
                <Save className="h-4 w-4" /> ذخیرهٔ تغییرات · Save changes
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={playtest} disabled={!codeOk} title="playtest vs AI">
              <Play className="h-4 w-4" /> آزمایش · Playtest
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { startNew(); }} title="new draft">
              <Wand2 className="h-4 w-4" /> جدید · New
            </Button>
            <Button variant="outline" size="sm" onClick={loadClassic} title="load classic layout">
              <LayoutGrid className="h-4 w-4" /> کلاسیک · Load classic
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll} title="clear all cells">
              <Eraser className="h-4 w-4" /> پاک‌کردن · Clear
            </Button>
            {editingCode && (
              <Button
                variant="destructive"
                size="sm"
                className="ms-auto"
                onClick={() => setDelTarget(list?.find((r) => r.code === editingCode) ?? ({ ...blankRow, code: editingCode } as AdminBoardRow))}
              >
                <Trash2 className="h-4 w-4" /> حذف · Delete
              </Button>
            )}
          </div>
          {editingCode && (
            <p className="text-center text-[10px] text-muted-foreground">
              در حال ویرایش: <span className="font-mono" dir="ltr">{editingCode}</span>
            </p>
          )}
        </div>

        {/* ------------------------------- list ------------------------------- */}
        <div className="royal-card rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-black">جدول‌های تیم · Team boards</h3>
            <Badge variant="outline" className="text-[10px]">{list ? fmt(list.length) : '…'}</Badge>
          </div>
          {!list ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/5" />)}
            </div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              هنوز جدولی طراحی نشده · No boards designed yet
            </p>
          ) : (
            <div className="nice-scroll max-h-[560px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">کد · code</TableHead>
                    <TableHead className="text-start">نام · name</TableHead>
                    <TableHead className="text-center">انتشار · live</TableHead>
                    <TableHead className="text-center">بازی · plays</TableHead>
                    <TableHead className="text-start">طراح · author</TableHead>
                    <TableHead className="text-end"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((b) => (
                    <TableRow key={b.id} className={cn(code === b.code && 'bg-amber-400/5')}>
                      <TableCell className="font-mono text-xs" dir="ltr">{b.code}</TableCell>
                      <TableCell className="max-w-[140px]">
                        <div className="truncate text-xs font-bold" dir="auto">{b.nameFa || b.nameEn || '—'}</div>
                        {b.nameEn && b.nameFa && <div className="truncate text-[10px] text-muted-foreground" dir="ltr">{b.nameEn}</div>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch checked={b.published} onCheckedChange={(v) => void togglePublish(b.code, b.published, v)} aria-label={`publish ${b.code}`} />
                      </TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{fmt(b.plays)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground" dir="auto">{b.author ?? '—'}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => loadBoard(b)} title="ویرایش · edit" aria-label={`edit ${b.code}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400 hover:text-rose-300" onClick={() => setDelTarget(b)} title="حذف · delete" aria-label={`delete ${b.code}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* delete confirm */}
      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <AlertDialogContent className="royal-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="gold-text">حذف جدول · Delete board</AlertDialogTitle>
            <AlertDialogDescription>
              جدول <b className="font-mono" dir="ltr">{delTarget?.code}</b> برای همیشه حذف می‌شود و بازی‌های در جریانِ آن به صفحهٔ کلاسیک برمی‌گردند ·
              This permanently removes the board; in-flight games fall back to the classic layout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{'انصراف · Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-500"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
            >
              <Trash2 className="h-4 w-4" /> {'حذف · Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
