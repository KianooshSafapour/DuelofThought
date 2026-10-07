'use client';

import { useEffect, useMemo, useRef } from 'react';
import { pieceSprite, avatarSprite, drawSprite, SpriteGrid } from '@/lib/pixel';
import { STORE_ITEMS } from '@/lib/game/content';

/** Canvas-rendered procedural pixel sprite (pieces & avatars). */
export function PixelSprite({
  kind, code, side = 1, scale = 6, glow = false, className,
}: {
  kind: 'piece' | 'avatar';
  code: string;
  side?: 1 | 2;
  scale?: number;
  glow?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  const grid: SpriteGrid = useMemo(() => {
    const item = STORE_ITEMS.find((i) => i.code === code) ?? STORE_ITEMS[0];
    const data = item.data as { p1?: string[]; p2?: string[]; seed?: number; pal?: string[] };
    if (kind === 'piece') {
      const pal = side === 1 ? (data.p1 ?? ['#e8965a', '#c96f3b', '#f7c59f']) : (data.p2 ?? ['#7fc8a9', '#4e9d7d', '#c9ecd9']);
      return pieceSprite(data.seed ?? 1, pal);
    }
    return avatarSprite(data.seed ?? 1, data.pal ?? ['#84cc16', '#365314', '#ecfccb']);
  }, [kind, code, side]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const item = STORE_ITEMS.find((i) => i.code === code);
    const data = (item?.data ?? {}) as { glow?: string; pal?: string[] };
    drawSprite(ctx, grid, scale, glow ? (data.glow ?? data.pal?.[0]) : undefined);
  }, [grid, scale, glow, code]);

  return (
    <canvas
      ref={ref}
      width={grid.size * scale}
      height={grid.size * scale}
      className={className}
      style={{ imageRendering: 'pixelated', width: grid.size * scale, height: grid.size * scale }}
      aria-hidden
    />
  );
}

export function PieceDisc({ code, side, size = 44 }: { code: string; side: 1 | 2; size?: number }) {
  const scale = Math.max(3, Math.round(size / 11));
  return <PixelSprite kind="piece" code={code} side={side} scale={scale} />;
}

export function AvatarBubble({ code, size = 40, glow }: { code: string; size?: number; glow?: boolean }) {
  const scale = Math.max(3, Math.round(size / 11));
  return <PixelSprite kind="avatar" code={code} scale={scale} glow={glow} className="rounded-md" />;
}
