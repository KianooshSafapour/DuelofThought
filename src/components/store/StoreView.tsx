'use client';

/**
 * StoreView — "بازار دوئل" (Duel Bazaar): category tabs, item grid with
 * procedural pixel-art previews, coin/level-gated buying (confirm dialog)
 * and one-click equip. /api/store is the source of truth; the useApp
 * session (coins / equipped fields) is kept in sync after every action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { localizeDigits, type Locale, type TKey } from '@/lib/i18n';
import { RARITY_META, ITEM_NAMES, type ItemCategory, type Rarity } from '@/lib/game/content';
import { AvatarBubble, PieceDisc } from '@/components/shared/PixelSprite';
import { CelebrationSprite } from '@/components/shared/CelebrationSprite';
import { sfx } from '@/lib/sound';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Coins,
  Eye,
  EyeOff,
  Gift,
  Package,
  PackageOpen,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/* ================= types & helpers ================= */

interface StoreItemDTO {
  code: string;
  category: ItemCategory;
  rarity: Rarity;
  price: number;
  requiredLevel: number;
  data: Record<string, unknown>;
  active: boolean;
  sales: number;
}

interface StoreMe {
  coins: number;
  level: number;
  pieceSkin: string;
  boardSkin: string;
  background: string;
  effectSkin: string;
  avatarItem: string;
  titleItem: string | null;
  emotePack: string;
  celebrationPack: string;
}

type EquipField = 'pieceSkin' | 'boardSkin' | 'background' | 'effectSkin' | 'avatarItem' | 'titleItem' | 'emotePack' | 'celebrationPack';

const CATS: ItemCategory[] = ['EMOTE', 'CELEBRATION', 'PIECE', 'BOARD', 'AVATAR', 'BACKGROUND', 'EFFECT', 'TITLE'];

const EQUIP_FIELD: Record<ItemCategory, EquipField> = {
  EMOTE: 'emotePack',
  CELEBRATION: 'celebrationPack',
  PIECE: 'pieceSkin',
  BOARD: 'boardSkin',
  BACKGROUND: 'background',
  EFFECT: 'effectSkin',
  AVATAR: 'avatarItem',
  TITLE: 'titleItem',
};

/** 'piece_rose' → 'Rose', 'bg_royal_velvet' → 'Royal velvet' */
function prettyName(code: string): string {
  const s = code.split('_').slice(1).join(' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

/**
 * Display name with premium override (celebration packs / new titles get real
 * bilingual names from ITEM_NAMES); falls back to prettyName everywhere else.
 */
function itemName(code: string, locale: Locale): string {
  const named = ITEM_NAMES[code];
  if (named) return locale === 'fa' ? named.fa : named.en;
  return prettyName(code);
}

/** Percent sign follows the script: Arabic percent for fa/ar, latin for en/tr. */
const PCT_SIGN: Record<Locale, string> = { fa: '٪', ar: '٪', en: '%', tr: '%' };

/** Immutably write the equipped code into the right equip field. */
function equipApply<T extends { pieceSkin?: string; boardSkin?: string; background?: string; effectSkin?: string; avatarItem?: string; titleItem?: string | null; emotePack?: string; celebrationPack?: string }>(
  obj: T,
  field: EquipField,
  code: string,
): T {
  const next = { ...obj };
  (next as Record<string, unknown>)[field] = code;
  return next;
}

/* ================= category previews (pure CSS / pixel sprites) ================= */

/**
 * Celebration pack preview — rest pose by default; dances on hover / focus /
 * tap (cheap: transform-only framer loops, one sprite at a time).
 */
function CelebrationPreview({ code, size = 76 }: { code: string; size?: number }) {
  const [dancing, setDancing] = useState(false);
  return (
    <span
      className="inline-block cursor-pointer"
      onMouseEnter={() => setDancing(true)}
      onMouseLeave={() => setDancing(false)}
      onFocus={() => setDancing(true)}
      onBlur={() => setDancing(false)}
      onPointerDown={() => {
        setDancing(true);
        window.setTimeout(() => setDancing(false), 2200); // touch: dance a moment
      }}
    >
      <CelebrationSprite code={code} size={size} dancing={dancing} />
    </span>
  );
}

function ItemPreview({ item, glow }: { item: StoreItemDTO; glow: boolean }) {
  const d = item.data as { cell?: string; cell2?: string; hole?: string; numeral?: string; colors?: string[]; accent?: string };

  switch (item.category) {
    case 'EMOTE': {
      const pack = (item.data as { emotes?: { id: string; emoji: string }[] }).emotes ?? [];
      return (
        <div className="flex h-16 w-full items-center justify-center gap-1.5">
          {pack.map((e) => (
            <span key={e.id} className={`grid h-9 w-9 place-items-center rounded-xl border text-xl ${glow ? 'border-amber-400/60 bg-amber-400/10' : 'border-border bg-muted/60'}`}>
              {e.emoji}
            </span>
          ))}
        </div>
      );
    }
    case 'CELEBRATION':
      return <CelebrationPreview code={item.code} />;
    case 'PIECE':
      return (
        <div style={glow ? { filter: `drop-shadow(0 0 7px ${RARITY_META[item.rarity].glow})` } : undefined}>
          <PieceDisc code={item.code} side={1} size={64} />
        </div>
      );
    case 'AVATAR':
      return <AvatarBubble code={item.code} size={64} glow={glow} />;
    case 'BOARD': {
      const cell = d.cell ?? '#e3b878';
      const cell2 = d.cell2 ?? '#d9a860';
      const hole = d.hole ?? '#faf6ee';
      const numeral = d.numeral ?? '#4a2e12';
      return (
        <div
          className="grid h-16 w-16 place-items-center rounded-lg"
          style={{
            background: `linear-gradient(135deg, ${cell}, ${cell2})`,
            border: `2px solid ${numeral}`,
            boxShadow: 'inset 0 1px 5px rgba(0,0,0,.35)',
          }}
        >
          <span className="block h-3.5 w-3.5 rounded-full" style={{ background: hole, boxShadow: `0 0 6px ${numeral}` }} />
        </div>
      );
    }
    case 'BACKGROUND': {
      const c = d.colors ?? ['#0f0524', '#1e1145', '#2a1a5e'];
      const accent = d.accent ?? '#d4af37';
      return (
        <div
          className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/15"
          style={{ background: `linear-gradient(135deg, ${c[0] ?? '#000'}, ${c[1] ?? '#111'} 55%, ${c[2] ?? '#222'})` }}
        >
          <span
            className="absolute bottom-1.5 end-1.5 block h-2.5 w-2.5 rounded-full"
            style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
          />
        </div>
      );
    }
    case 'EFFECT': {
      const c = d.colors ?? ['#fbbf24', '#f472b6', '#34d399', '#c084fc'];
      return (
        <div
          className="grid h-16 w-16 place-items-center text-[34px]"
          style={{
            background: `linear-gradient(135deg, ${c.join(', ')})`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
          aria-hidden
        >
          🎉
        </div>
      );
    }
    case 'TITLE':
      return (
        <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg bg-amber-400/10">
          <span className="text-2xl" aria-hidden>
            👑
          </span>
          <span className="max-w-14 truncate text-[9px] font-black text-amber-300">{prettyName(item.code)}</span>
        </div>
      );
    default:
      return null;
  }
}

/* ================= v0.1.0-alpha: Fortune Chests (صندوق‌های شانس) ================= */

type DropKind = 'COINS' | 'XP' | 'ITEM';

interface MarketDropDTO {
  id: string;
  kind: DropKind;
  itemCode: string | null;
  amount: number;
  weight: number;
}

interface MarketBoxDTO {
  code: string;
  rarity: Rarity;
  price: number;
  image: string;
  opens: number;
  drops: MarketDropDTO[];
}

interface BoxGrantDTO {
  id: string;
  boxCode: string;
  source: string; // PURCHASE | GIFT | ADMIN
  createdAt: string;
}

interface OpenResultDTO {
  ok: boolean;
  drop: { kind: DropKind; itemCode: string | null; amount: number };
  item: { code: string; dupe: boolean; refund: number; rarity: string } | null;
  coinsDelta: number;
  xpDelta: number;
  levelUps: number;
  user: { coins: number; xp: number; level: number };
  unlockedAchievements: { id: string; coins: number; rarity: string }[];
}

type StoreTab = 'CHESTS' | ItemCategory;

/** Fallback emoji when an ITEM drop has no procedural preview available. */
const ITEM_EMOJI: Record<string, string> = {
  piece: '⚪',
  board: '▦',
  avatar: '🙂',
  background: '🖼️',
  effect: '✨',
  title: '👑',
  celeb: '🎉',
};

/**
 * Chest artwork. The /art renders are 1024² with a dark backdrop, so they sit
 * on a dark rounded+ring tile and use mix-blend-screen to melt into any bg.
 * If the png is missing (404), we gracefully fall back to a rarity-tinted
 * gradient tile with a gift emoji — the experience never breaks.
 */
function ChestGlyph({ rarity, size }: { rarity: Rarity; size: number }) {
  const meta = RARITY_META[rarity];
  return (
    <span style={{ fontSize: Math.round(size * 0.42), filter: `drop-shadow(0 0 10px ${meta.glow})` }} aria-hidden>
      🎁
    </span>
  );
}

function ChestArt({ image, rarity, size }: { image: string; rarity: Rarity; size: number }) {
  const meta = RARITY_META[rarity];
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(120% 120% at 50% 18%, ${meta.color}2e 0%, #06060e 62%)`,
        boxShadow: `0 0 ${Math.round(size / 4)}px ${meta.glow}, inset 0 0 16px rgba(0,0,0,.55)`,
      }}
    >
      {image ? (
        <ChestImg key={image} image={image} rarity={rarity} size={size} />
      ) : (
        <ChestGlyph rarity={rarity} size={size} />
      )}
    </div>
  );
}

/** Image loader with per-src error fallback (remounts reset the error state). */
function ChestImg({ image, rarity, size }: { image: string; rarity: Rarity; size: number }) {
  const [err, setErr] = useState(false);
  if (err) return <ChestGlyph rarity={rarity} size={size} />;
  return (
    <Image
      src={image}
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      className="object-contain mix-blend-screen"
      style={{ filter: `drop-shadow(0 0 10px ${RARITY_META[rarity].glow})` }}
      onError={() => setErr(true)}
    />
  );
}

/** Rotating conic-gradient burst rays, revealed behind the reward. */
function BurstRays({ color }: { color: string }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 m-auto h-[440px] w-[440px] rounded-full"
      style={{
        background: `repeating-conic-gradient(from 0deg, ${color}40 0deg 7deg, transparent 7deg 18deg)`,
        WebkitMaskImage: 'radial-gradient(closest-side, rgba(0,0,0,.95), transparent 74%)',
        maskImage: 'radial-gradient(closest-side, rgba(0,0,0,.95), transparent 74%)',
      }}
      initial={{ opacity: 0, scale: 0.35, rotate: 0 }}
      animate={{ opacity: [0, 0.9, 0.55], scale: [0.35, 1, 1.1], rotate: 360 }}
      transition={{
        opacity: { duration: 0.9 },
        scale: { duration: 0.8, ease: 'easeOut' },
        rotate: { duration: 18, repeat: Infinity, ease: 'linear' },
      }}
    />
  );
}

const CONFETTI_COLORS = ['#fbbf24', '#f472b6', '#34d399', '#c084fc', '#f43f5e', '#38bdf8', '#fde047'];

/** Lightweight confetti — absolutely-positioned animated divs, no new deps. */
function Confetti({ seed }: { seed: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 340,
        y: -(70 + Math.random() * 170),
        rot: Math.random() * 720 - 360,
        dur: 1 + Math.random(),
        delay: Math.random() * 0.18,
        c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 5 + Math.random() * 6,
      })),
    [seed],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {parts.map((p) => (
        <motion.span
          key={`${seed}-${p.id}`}
          className="absolute left-1/2 top-[38%] block rounded-[2px]"
          style={{ width: p.w, height: Math.round(p.w * 0.5), background: p.c }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [0, p.y, 330], opacity: [1, 1, 0], rotate: p.rot }}
          transition={{ duration: p.dur + 0.9, delay: p.delay, ease: 'easeOut', times: [0, 0.42, 1] }}
        />
      ))}
    </div>
  );
}

/** Big reward icon inside the reveal ring (reuses the item renderers above). */
function RewardVisual({ kind, itemCode, catalogItem }: { kind: DropKind; itemCode: string | null; catalogItem: StoreItemDTO | null }) {
  if (kind === 'COINS') return <span className="text-5xl drop-shadow-[0_0_16px_rgba(251,191,36,.85)]" aria-hidden>🪙</span>;
  if (kind === 'XP') return <span className="text-5xl text-violet-300 drop-shadow-[0_0_16px_rgba(192,132,252,.85)]" aria-hidden>✦</span>;
  const code = itemCode ?? '';
  const prefix = code.split('_')[0] ?? '';
  if (prefix === 'piece') return <PieceDisc code={code} side={1} size={72} />;
  if (prefix === 'avatar') return <AvatarBubble code={code} size={72} glow />;
  if (prefix === 'celeb') return <CelebrationSprite code={code} size={72} dancing />;
  if (catalogItem) return <ItemPreview item={catalogItem} glow />;
  return <span className="text-5xl" aria-hidden>{ITEM_EMOJI[prefix] ?? '📦'}</span>;
}

/** Reveal stage of the opening dialog: burst rays + glow ring + reward card. */
function RevealContent({
  result,
  box,
  catalog,
  remaining,
  seed,
  t,
  locale,
  onAnother,
  onClose,
}: {
  result: OpenResultDTO;
  box: MarketBoxDTO;
  catalog: StoreItemDTO[];
  remaining: number;
  seed: number;
  t: (k: TKey) => string;
  locale: Locale;
  onAnother: () => void;
  onClose: () => void;
}) {
  const item = result.item;
  const rar = (item ? (item.rarity as Rarity) : box.rarity);
  const rmeta = RARITY_META[rar];
  const catItem = item ? catalog.find((it) => it.code === item.code) ?? null : null;
  return (
    <motion.div
      initial={{ scale: 0.55, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 240, damping: 17 }}
      className="relative flex w-full flex-col items-center"
    >
      <div className="relative mt-1 grid place-items-center">
        <BurstRays color={rmeta.color} />
        <Confetti seed={seed} />
        <div
          className="relative grid h-28 w-28 place-items-center rounded-full border-2"
          style={{
            borderColor: `${rmeta.color}99`,
            boxShadow: `0 0 70px ${rmeta.glow}, inset 0 0 26px ${rmeta.glow}`,
            background: '#06060e',
          }}
        >
          <RewardVisual kind={result.drop.kind} itemCode={result.drop.itemCode} catalogItem={catItem} />
        </div>
      </div>

      <div className="mt-3 text-lg font-black gold-text">{t('box_congrats')}</div>

      {result.drop.kind === 'COINS' && (
        <>
          <div className="mt-1 text-2xl font-black text-amber-400">+{localizeDigits(result.drop.amount, locale)} 🪙</div>
          <div className="text-xs font-bold text-muted-foreground">{t('box_won_coins')}</div>
        </>
      )}
      {result.drop.kind === 'XP' && (
        <>
          <div className="mt-1 text-2xl font-black text-violet-300">+{localizeDigits(result.drop.amount, locale)} ✦</div>
          <div className="text-xs font-bold text-muted-foreground">{t('box_won_xp')}</div>
        </>
      )}
      {result.drop.kind === 'ITEM' && item && (
        <>
          <div className="mt-1 max-w-full truncate text-base font-black" style={{ color: rmeta.color }}>
            {itemName(item.code, locale)}
          </div>
          <Badge
            variant="outline"
            className="mt-1 text-[9px] font-black"
            style={{ color: rmeta.color, borderColor: `${rmeta.color}55`, background: `${rmeta.color}14` }}
          >
            {t('box_won_item')} · {t(`rarity_${rar}` as TKey)}
          </Badge>
          {item.dupe && (
            <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-300">
              {t('box_dupe')} · 🪙 +{localizeDigits(item.refund, locale)}
            </div>
          )}
        </>
      )}

      {result.levelUps > 0 && (
        <div className="mt-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          ⬆ {t('level_up')} · {t('level')} {localizeDigits(result.user.level, locale)}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {remaining > 0 && (
          <Button className="h-11 px-5 font-black glow-gold" onClick={onAnother}>
            <PackageOpen className="h-4 w-4" />
            {t('box_open')}
          </Button>
        )}
        <Button variant="outline" className="h-11 px-5 font-black" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </motion.div>
  );
}

/* ================= view ================= */

export function StoreView() {
  const { user, t, locale, patchUser, refreshSession } = useApp();
  const uid = user?.id;
  const [items, setItems] = useState<StoreItemDTO[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [me, setMe] = useState<StoreMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<StoreTab>('CHESTS');
  const [confirmItem, setConfirmItem] = useState<StoreItemDTO | null>(null);
  const [busyBuy, setBusyBuy] = useState<string | null>(null);

  /* ---------- fortune chests (market) state ---------- */
  const [boxes, setBoxes] = useState<MarketBoxDTO[]>([]);
  const [inventory, setInventory] = useState<BoxGrantDTO[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [oddsFor, setOddsFor] = useState<string | null>(null);
  const [confirmBox, setConfirmBox] = useState<MarketBoxDTO | null>(null);
  const [busyBox, setBusyBox] = useState(false);
  const [opening, setOpening] = useState<{ grant: BoxGrantDTO; box: MarketBoxDTO } | null>(null);
  const [openPhase, setOpenPhase] = useState<'shake' | 'reveal'>('shake');
  const [openResult, setOpenResult] = useState<OpenResultDTO | null>(null);
  const [revealSeed, setRevealSeed] = useState(0);
  const [flash, setFlash] = useState(false);

  /* catalog + ownership; refetches when session appears/changes */
  useEffect(() => {
    let live = true;
    api
      .get<{ items: StoreItemDTO[]; owned: string[]; me: StoreMe | null }>('/api/store')
      .then((d) => {
        if (!live) return;
        setItems(d.items);
        setOwned(d.owned);
        setMe(d.me);
      })
      .catch(() => {
        if (live) toast.error(t('error'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [t, uid]);

  /* ---------- market: chest catalog + my unopened grants ---------- */
  const refreshMarket = useCallback(
    async (silent = false) => {
      try {
        const d = await api.get<{ boxes: MarketBoxDTO[]; inventory: BoxGrantDTO[]; me: { coins: number; level: number } | null }>('/api/market');
        setBoxes(d.boxes);
        setInventory(d.inventory);
        const dm = d.me;
        if (dm) setMe((m) => (m ? { ...m, coins: dm.coins, level: dm.level } : m));
      } catch {
        if (!silent) toast.error(t('error'));
      } finally {
        setMarketLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void refreshMarket();
  }, [refreshMarket, uid]);

  const coins = me?.coins ?? user?.coins ?? 0;
  const level = me?.level ?? user?.level ?? 1;
  const cur = me ??
    (user
      ? {
          pieceSkin: user.pieceSkin,
          boardSkin: user.boardSkin,
          background: user.background,
          effectSkin: user.effectSkin,
          avatarItem: user.avatarItem,
          titleItem: user.titleItem,
          emotePack: user.emotePack,
          celebrationPack: user.celebrationPack,
        }
      : null);

  const isEquipped = (item: StoreItemDTO) => (cur ? cur[EQUIP_FIELD[item.category]] === item.code : false);

  const shown = items
    .filter((i) => i.category === cat)
    .sort((a, b) => RARITY_META[a.rarity].order - RARITY_META[b.rarity].order || a.price - b.price);

  /* ---------- buy ---------- */
  const doBuy = async () => {
    if (!confirmItem) return;
    const target = confirmItem;
    setBusyBuy(target.code);
    try {
      const res = await api.post<{ ok: boolean; coins: number }>('/api/store', { code: target.code });
      sfx.coin();
      toast.success(t('purchased'));
      setOwned((o) => (o.includes(target.code) ? o : [...o, target.code]));
      setMe((m) => (m && typeof res.coins === 'number' ? { ...m, coins: res.coins } : m));
      void refreshSession();
    } catch (e) {
      const code = (e as Error).message;
      const need = (e as { payload?: { need?: number } }).payload?.need;
      if (code === 'COINS') toast.error(t('not_enough'));
      else if (code === 'LEVEL') toast.error(`${t('need_level')} ${localizeDigits(need ?? target.requiredLevel, locale)}`);
      else if (code === 'OWNED') {
        toast.error(t('owned'));
        setOwned((o) => (o.includes(target.code) ? o : [...o, target.code]));
      } else if (code === 'AUTH') toast.error(t('login'));
      else toast.error(t('error'));
    } finally {
      setBusyBuy(null);
      setConfirmItem(null);
    }
  };

  /* ---------- chest buy (play-earned coins only) ---------- */
  const doBuyBox = async () => {
    if (!confirmBox) return;
    const target = confirmBox;
    setBusyBox(true);
    try {
      const res = await api.post<{ ok: boolean; coins: number }>('/api/market', { action: 'buy', boxCode: target.code });
      sfx.coin();
      toast.success(t('purchased'));
      if (user && typeof res.coins === 'number') patchUser({ coins: res.coins });
      setMe((m) => (m && typeof res.coins === 'number' ? { ...m, coins: res.coins } : m));
      void refreshMarket(true);
    } catch (e) {
      const code = (e as Error).message;
      if (code === 'COINS') toast.error(t('not_enough'));
      else if (code === 'AUTH') toast.error(t('login'));
      else toast.error(t('error'));
    } finally {
      setBusyBox(false);
      setConfirmBox(null);
    }
  };

  /* ---------- chest OPEN: suspense ≥900 ms, then reveal ---------- */
  const busyOpenRef = useRef(false); // double-fire guard (survives stale closures)
  const startOpen = (grant: BoxGrantDTO) => {
    if (!user || busyOpenRef.current) return;
    const box = boxes.find((b) => b.code === grant.boxCode);
    if (!box) return;
    busyOpenRef.current = true;
    sfx.click();
    setRevealSeed((s) => s + 1);
    setOpenResult(null);
    setOpenPhase('shake');
    setOpening({ grant, box });
    const t0 = Date.now();
    void (async () => {
      try {
        const res = await api.post<OpenResultDTO>('/api/market', { action: 'open', grantId: grant.id });
        const wait = Math.max(0, 900 - (Date.now() - t0)); // suspense always plays
        window.setTimeout(() => {
          busyOpenRef.current = false; // "open another" may fire again
          setOpenResult(res);
          setOpenPhase('reveal');
          /* sync zustand session + server truth */
          patchUser({ coins: res.user.coins, xp: res.user.xp, level: res.user.level });
          void refreshSession();
          void refreshMarket(true);
          /* reveal sound design: coin for coins, fanfare for items/big rarities */
          const rar = (res.item ? (res.item.rarity as Rarity) : box.rarity);
          if (res.drop.kind === 'ITEM' || rar === 'LEGENDARY' || rar === 'ULTIMATE') sfx.achievement();
          else sfx.coin();
          if (rar === 'ULTIMATE' || box.rarity === 'ULTIMATE') {
            setFlash(true);
            window.setTimeout(() => setFlash(false), 280);
          }
          for (const a of res.unlockedAchievements) {
            toast.success(`🏅 ${t('ach_unlocked')} +${localizeDigits(a.coins, locale)} 🪙`);
          }
          if (res.levelUps > 0) sfx.levelup();
        }, wait);
      } catch (e) {
        const errCode = (e as Error).message;
        window.setTimeout(
          () => {
            busyOpenRef.current = false;
            if (errCode === 'AUTH') toast.error(t('login'));
            else toast.error(t('error'));
            setOpening(null);
            void refreshMarket(true);
          },
          Math.max(0, 600 - (Date.now() - t0)),
        );
      }
    })();
  };

  const closeOpening = () => {
    /* keep the suspense unskippable while the chest shakes */
    if (openPhase === 'shake') return;
    busyOpenRef.current = false;
    setOpening(null);
    setOpenResult(null);
    setOpenPhase('shake');
  };

  const openAnother = () => {
    if (!opening) return;
    const next = inventory.find((g) => g.id !== opening.grant.id);
    if (!next) {
      closeOpening();
      return;
    }
    startOpen(next);
  };

  const remainingAfterOpen = opening ? inventory.filter((g) => g.id !== opening.grant.id).length : 0;

  /* ---------- equip ---------- */
  const doEquip = async (item: StoreItemDTO) => {
    try {
      await api.post('/api/store/equip', { code: item.code });
      sfx.click();
      toast.success(t('equipped_done'));
      const field = EQUIP_FIELD[item.category];
      if (user) patchUser(equipApply(user, field, item.code));
      setMe((m) => (m ? equipApply(m, field, item.code) : m));
      void refreshSession();
    } catch {
      toast.error(t('error'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10">
      {/* ---------- header ---------- */}
      <section className="royal-card relative mt-4 overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 shimmer" aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">
              🛒 <span className="gold-text">{t('store_title')}</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t('store_sub')}</p>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-400/10 px-3.5 py-1.5 text-sm font-black text-amber-400 glow-gold"
            title={t('coins')}
          >
            <Coins className="h-4 w-4" />
            {localizeDigits(coins, locale)}
            <span className="text-[10px] font-bold opacity-75">{t('coins')}</span>
          </div>
        </div>
        {!user && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('auth_no')} <b className="text-amber-400">{t('login')} →</b>
          </p>
        )}
      </section>

      {/* ---------- category tabs ---------- */}
      <Tabs
        value={cat}
        onValueChange={(v) => {
          sfx.click();
          setCat(v as StoreTab);
        }}
        className="mt-4"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1 sm:w-fit">
          <TabsTrigger value="CHESTS" className="gap-1.5 px-3 text-xs font-bold">
            <Gift className="h-3.5 w-3.5 text-amber-400" />
            {t('market_tab_boxes')}
          </TabsTrigger>
          {CATS.map((c) => (
            <TabsTrigger key={c} value={c} className="px-3 text-xs font-bold">
              {t(`cat_${c}` as TKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ---------- fortune chests (first tab) ---------- */}
      {cat === 'CHESTS' && (
        <section className="mt-4 space-y-6" aria-label={t('box_title')}>
          {/* header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-black">
                🎁 <span className="gold-text">{t('box_title')}</span>
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('box_sub')}</p>
            </div>
            {!user && (
              <p className="text-xs text-muted-foreground">
                {t('auth_no')} <b className="text-amber-400">{t('login')} →</b>
              </p>
            )}
          </div>

          {/* chest cards — 2 cols mobile / 5 desktop */}
          {marketLoading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="royal-card flex flex-col items-center gap-3 rounded-2xl p-4">
                  <Skeleton className="h-28 w-28 rounded-2xl" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
            </div>
          ) : boxes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">—</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {boxes.map((b, i) => {
                const meta = RARITY_META[b.rarity];
                const totalW = b.drops.reduce((s, d) => s + d.weight, 0);
                const afford = !!user && coins >= b.price;
                return (
                  <motion.div
                    key={b.code}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.35, ease: 'easeOut' }}
                    className="royal-card card-shine relative flex flex-col items-center gap-2 rounded-2xl p-3 text-center transition-transform hover:scale-[1.02]"
                    style={{ borderColor: `${meta.color}44` }}
                  >
                    <ChestArt image={b.image} rarity={b.rarity} size={116} />

                    <Badge
                      variant="outline"
                      className="text-[9px] font-black"
                      style={{ color: meta.color, borderColor: `${meta.color}55`, background: `${meta.color}14` }}
                    >
                      {t(`rarity_${b.rarity}` as TKey)}
                    </Badge>

                    <div className="flex w-full items-center justify-center gap-1.5">
                      <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-400/10 px-2.5 py-1 text-xs font-black text-amber-400">
                        🪙 {localizeDigits(b.price, locale)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          sfx.click();
                          setOddsFor(oddsFor === b.code ? null : b.code);
                        }}
                        aria-label={t('box_odds')}
                        aria-expanded={oddsFor === b.code}
                        className="pressable grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {oddsFor === b.code ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* odds panel (client-side weight math, sorted desc) */}
                    <AnimatePresence initial={false}>
                      {oddsFor === b.code && (
                        <motion.div
                          key="odds"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.28, ease: 'easeOut' }}
                          className="w-full overflow-hidden"
                        >
                          <div className="w-full rounded-xl border border-white/10 bg-black/30 p-2 text-start">
                            <div className="mb-1 px-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t('box_odds')}</div>
                            <ul className="space-y-1">
                              {b.drops
                                .map((d) => ({ d, pct: totalW > 0 ? Math.round((d.weight / totalW) * 1000) / 10 : 0 }))
                                .sort((x, y) => y.pct - x.pct)
                                .map(({ d, pct }) => {
                                  const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
                                  const catItem = d.kind === 'ITEM' && d.itemCode ? items.find((it) => it.code === d.itemCode) : undefined;
                                  return (
                                    <li key={d.id} className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[11px]">
                                      {d.kind === 'COINS' ? (
                                        <Coins className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                                      ) : d.kind === 'XP' ? (
                                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                                      ) : (
                                        <Package className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                                      )}
                                      <span className="min-w-0 flex-1 truncate font-bold">
                                        {d.kind === 'ITEM'
                                          ? (catItem ? prettyName(catItem.code) : prettyName(d.itemCode ?? 'item'))
                                          : `${t(d.kind === 'COINS' ? 'gift_coins' : 'gift_xp')} +${localizeDigits(d.amount, locale)}`}
                                      </span>
                                      {catItem && (
                                        <span
                                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                                          style={{ background: RARITY_META[catItem.rarity].color }}
                                          title={t(`rarity_${catItem.rarity}` as TKey)}
                                        />
                                      )}
                                      <span className="shrink-0 font-black" style={{ color: meta.color }}>
                                        {localizeDigits(pctStr, locale)}{PCT_SIGN[locale]}
                                      </span>
                                    </li>
                                  );
                                })}
                            </ul>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* buy — play-earned coins only */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="mt-auto block w-full pt-1">
                          <Button
                            size="sm"
                            className="h-11 w-full font-black glow-gold"
                            disabled={!afford}
                            onClick={() => {
                              sfx.click();
                              setConfirmBox(b);
                            }}
                          >
                            <Gift className="h-4 w-4" />
                            {t('box_buy')}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!user && <TooltipContent>{t('auth_no')} {t('login')} →</TooltipContent>}
                      {user && !afford && <TooltipContent>{t('not_enough')}</TooltipContent>}
                    </Tooltip>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* my chests — unopened grants strip */}
          <section aria-label={t('box_inventory')}>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-black">
              <PackageOpen className="h-4 w-4 text-amber-400" />
              {t('box_inventory')}
              {inventory.length > 0 && (
                <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] font-black text-amber-300">
                  {localizeDigits(inventory.length, locale)}
                </Badge>
              )}
            </h3>
            {inventory.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-muted-foreground">{t('box_empty')}</p>
            ) : (
              <div className="nice-scroll flex gap-2 overflow-x-auto pb-2">
                {inventory.map((g) => {
                  const gb = boxes.find((x) => x.code === g.boxCode);
                  const gMeta = RARITY_META[gb?.rarity ?? 'COMMON'];
                  const gift = g.source === 'GIFT' || g.source === 'ADMIN';
                  return (
                    <div key={g.id} className="royal-card flex shrink-0 items-center gap-2 rounded-2xl p-2 pe-3" style={{ borderColor: `${gMeta.color}44` }}>
                      <div className="relative">
                        <ChestArt image={gb?.image ?? ''} rarity={gb?.rarity ?? 'COMMON'} size={52} />
                        {gift && (
                          <span className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-amber-400 text-[10px] shadow" title={g.source} aria-hidden>
                            🎁
                          </span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <span className="text-[10px] font-black" style={{ color: gMeta.color }}>
                          {t(`rarity_${gb?.rarity ?? 'COMMON'}` as TKey)}
                        </span>
                        <Button size="sm" className="h-11 px-4 font-black glow-gold" disabled={!gb} onClick={() => gb && startOpen(g)}>
                          <PackageOpen className="h-4 w-4" />
                          {t('box_open')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* brand law: chests are bought ONLY with play-earned coins — no real money, ever */}
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
            <span>
              <span dir="rtl" className="block">
                سکه‌ها فقط از راه بازی، دستاورد و رویدادها به‌دست می‌آیند — خرید واقعی وجود ندارد.
              </span>
              <span dir="ltr" className="block text-start">
                Coins come only from playing, achievements and events — no real-money purchases.
              </span>
            </span>
          </p>
        </section>
      )}

      {/* ---------- item grid ---------- */}
      {cat !== 'CHESTS' && (
      <div className="nice-scroll mt-4 max-h-[70dvh] overflow-y-auto pb-2 pe-1">
        {cat === 'CELEBRATION' && (
          <p className="mb-3 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/10 px-3.5 py-2 text-xs font-bold text-fuchsia-200">
            🕺 {t('celebrate_hint')}
          </p>
        )}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="royal-card flex flex-col items-center gap-3 rounded-2xl p-4">
                <Skeleton className="h-16 w-16 rounded-lg" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">—</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((item) => {
              const meta = RARITY_META[item.rarity];
              const glow = item.rarity === 'EPIC' || item.rarity === 'LEGENDARY';
              const isOwned = owned.includes(item.code);
              const equipped = isEquipped(item);
              const canAfford = coins >= item.price;
              const levelOk = level >= item.requiredLevel;
              return (
                <div
                  key={item.code}
                  className="royal-card card-shine group relative flex flex-col items-center gap-2 rounded-2xl p-3 pt-4 text-center transition-all hover:scale-[1.02]"
                  style={{ borderColor: `${meta.color}3a` }}
                >
                  {isOwned && (
                    <Badge variant="outline" className="absolute end-2 top-2 border-emerald-500/40 bg-emerald-500/10 text-[9px] font-black text-emerald-300">
                      {t('owned')}
                    </Badge>
                  )}
                  {equipped && (
                    <Badge variant="outline" className="absolute start-2 top-2 border-amber-400/50 bg-amber-400/15 text-[9px] font-black text-amber-300">
                      {t('equipped')}
                    </Badge>
                  )}

                  <div className="transition-transform group-hover:scale-105">
                    <ItemPreview item={item} glow={glow} />
                  </div>

                  <div className="max-w-full truncate text-sm font-black">{itemName(item.code, locale)}</div>

                  <Badge
                    variant="outline"
                    className="text-[9px] font-black"
                    style={{ color: meta.color, borderColor: `${meta.color}55`, background: `${meta.color}14` }}
                  >
                    {t(`rarity_${item.rarity}` as TKey)}
                  </Badge>

                  <div className="text-xs font-black">
                    {item.price === 0 ? (
                      <span className="text-emerald-400">FREE</span>
                    ) : (
                      <span className="text-amber-400">🪙 {localizeDigits(item.price, locale)}</span>
                    )}
                  </div>

                  <div className="mt-auto w-full pt-1">
                    {isOwned ? (
                      equipped ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="w-full border-amber-400/50 bg-amber-400/10 font-black text-amber-300"
                        >
                          ✓ {t('equipped')}
                        </Button>
                      ) : (
                        <Button size="sm" className="w-full font-black" onClick={() => void doEquip(item)}>
                          {t('equip')}
                        </Button>
                      )
                    ) : !levelOk ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block w-full cursor-not-allowed">
                            <Button size="sm" variant="secondary" disabled className="w-full">
                              🔒 {t('locked')}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('need_level')} {localizeDigits(item.requiredLevel, locale)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block w-full">
                            <Button
                              size="sm"
                              className="w-full glow-gold font-black"
                              disabled={!canAfford || busyBuy === item.code}
                              onClick={() => setConfirmItem(item)}
                            >
                              {busyBuy === item.code ? '…' : t('buy')}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!canAfford && <TooltipContent>{t('not_enough')}</TooltipContent>}
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* ---------- chest buy confirm ---------- */}
      <AlertDialog open={!!confirmBox} onOpenChange={(o) => !o && setConfirmBox(null)}>
        <AlertDialogContent className="royal-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="gold-text">{t('box_buy')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {confirmBox && (
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-foreground">
                      {t('gift_box')} · {t(`rarity_${confirmBox.rarity}` as TKey)}
                    </b>
                    <span className="font-bold text-amber-400">🪙 {localizeDigits(confirmBox.price, locale)}</span>
                    <span>
                      {t('coins')}: {localizeDigits(coins, locale)}
                    </span>
                  </span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="glow-gold" disabled={busyBox} onClick={() => void doBuyBox()}>
              {busyBox ? '…' : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- chest opening experience (suspense → reveal) ---------- */}
      <Dialog
        open={!!opening}
        onOpenChange={(o) => {
          if (!o) closeOpening();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#07070f]/95 p-6 text-center shadow-2xl backdrop-blur-xl"
        >
          {opening && (
            <>
              <DialogTitle className="sr-only">
                {t('box_title')} — {t(`rarity_${opening.box.rarity}` as TKey)}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('box_opening_anim')}</DialogDescription>

              <div className="relative flex min-h-[320px] flex-col items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                  {openPhase === 'shake' ? (
                    <motion.div key="shake" className="flex flex-col items-center" exit={{ opacity: 0, scale: 1.15 }} transition={{ duration: 0.18 }}>
                      {/* escalating wiggle while the server rolls */}
                      <motion.div
                        animate={{ rotate: [0, -3, 3, -6, 6, -9, 9, -12, 12, 0], scale: [1, 1.03, 1, 1.05, 1, 1.07, 1] }}
                        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                      >
                        <ChestArt image={opening.box.image} rarity={opening.box.rarity} size={190} />
                      </motion.div>
                      <motion.p
                        className="mt-6 text-sm font-black text-amber-300"
                        animate={{ opacity: [0.45, 1, 0.45] }}
                        transition={{ duration: 1.1, repeat: Infinity }}
                      >
                        {t('box_opening_anim')}
                      </motion.p>
                    </motion.div>
                  ) : openResult ? (
                    <RevealContent
                      key={`reveal-${revealSeed}`}
                      result={openResult}
                      box={opening.box}
                      catalog={items}
                      remaining={remainingAfterOpen}
                      seed={revealSeed}
                      t={t}
                      locale={locale}
                      onAnother={openAnother}
                      onClose={closeOpening}
                    />
                  ) : null}
                </AnimatePresence>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ULTIMATE screen flash */}
      {flash && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[70] bg-white"
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          aria-hidden
        />
      )}

      {/* ---------- buy confirm dialog ---------- */}
      <AlertDialog open={!!confirmItem} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <AlertDialogContent className="royal-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="gold-text">{t('buy_confirm')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {confirmItem && (
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-foreground">{itemName(confirmItem.code, locale)}</b>
                    <span className="font-bold text-amber-400">🪙 {localizeDigits(confirmItem.price, locale)}</span>
                    <span>
                      {t('coins')}: {localizeDigits(coins, locale)}
                    </span>
                  </span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="glow-gold" onClick={() => void doBuy()}>
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
