import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const equipSchema = z.object({ code: z.string().min(2).max(40) });

const FIELD_MAP: Record<string, 'pieceSkin' | 'boardSkin' | 'background' | 'effectSkin' | 'avatarItem' | 'titleItem' | 'emotePack' | 'celebrationPack'> = {
  PIECE: 'pieceSkin', BOARD: 'boardSkin', BACKGROUND: 'background', EFFECT: 'effectSkin', AVATAR: 'avatarItem', TITLE: 'titleItem', EMOTE: 'emotePack', CELEBRATION: 'celebrationPack',
};

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });

  const body = equipSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const item = await db.storeItem.findUnique({ where: { code: body.data.code } });
  if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const field = FIELD_MAP[item.category];
  if (!field) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  // must own it (free items grant ownership at register; enforce anyway)
  if (item.price > 0) {
    const owned = await db.purchase.findUnique({ where: { userId_itemId: { userId: me.id, itemId: item.code } } });
    if (!owned) return NextResponse.json({ error: 'NOT_OWNED' }, { status: 403 });
    if (me.level < item.requiredLevel) return NextResponse.json({ error: 'LEVEL', need: item.requiredLevel }, { status: 403 });
  } else if (me.level < item.requiredLevel) {
    return NextResponse.json({ error: 'LEVEL', need: item.requiredLevel }, { status: 403 });
  }

  const updated = await db.user.update({ where: { id: me.id }, data: { [field]: item.code } });
  return NextResponse.json({ ok: true, [field]: item.code, level: updated.level });
}
