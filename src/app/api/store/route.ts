import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Store catalog + the caller's ownership state */
export async function GET() {
  const me = await currentUser();
  const [items, owned] = await Promise.all([
    db.storeItem.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    me ? db.purchase.findMany({ where: { userId: me.id }, select: { itemId: true } }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    items: items.map((i) => ({ ...i, data: JSON.parse(i.data) })),
    owned: owned.map((o) => o.itemId),
    me: me ? { coins: me.coins, level: me.level, pieceSkin: me.pieceSkin, boardSkin: me.boardSkin, background: me.background, effectSkin: me.effectSkin, avatarItem: me.avatarItem, titleItem: me.titleItem, emotePack: me.emotePack, celebrationPack: me.celebrationPack } : null,
  });
}

const purchaseSchema = z.object({ code: z.string().min(2).max(40) });

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`buy:${me.id}`, 15, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = purchaseSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const item = await db.storeItem.findUnique({ where: { code: body.data.code } });
  if (!item || !item.active) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const already = await db.purchase.findUnique({
    where: { userId_itemId: { userId: me.id, itemId: item.code } },
  });
  if (already) return NextResponse.json({ error: 'OWNED' }, { status: 409 });
  if (me.level < item.requiredLevel) return NextResponse.json({ error: 'LEVEL', need: item.requiredLevel }, { status: 403 });
  if (me.coins < item.price) return NextResponse.json({ error: 'COINS', need: item.price - me.coins }, { status: 402 });

  const [, , user2] = await Promise.all([
    db.purchase.create({ data: { userId: me.id, itemId: item.code, price: item.price } }),
    db.storeItem.update({ where: { code: item.code }, data: { sales: { increment: 1 } } }),
    db.user.update({ where: { id: me.id }, data: { coins: { decrement: item.price } } }),
  ]);
  await db.analyticsEvent.create({
    data: { userId: me.id, type: 'purchase', payload: JSON.stringify({ code: item.code, price: item.price, category: item.category }) },
  });

  return NextResponse.json({ ok: true, coins: user2.coins });
}
