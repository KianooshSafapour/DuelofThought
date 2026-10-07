import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

const giftSchema = z.object({
  username: z.string().min(1).optional(),
  all: z.boolean().optional(),
  coins: z.number().int().min(0).max(1_000_000).optional(),
  xp: z.number().int().min(0).max(1_000_000).optional(),
  itemCode: z.string().min(2).max(40).optional(),
  boxCode: z.string().min(3).max(40).optional(),
  note: z.string().max(200).optional(),
});

/** POST /api/admin/gift — gift coins/xp/items/chests to one user or everyone */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const body = giftSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { username, all, coins, xp, itemCode, boxCode, note } = body.data;
  if (!coins && !xp && !itemCode && !boxCode) return NextResponse.json({ error: 'EMPTY' }, { status: 400 });

  /* validate referenced items */
  let item: { code: string } | null = null;
  let box: { code: string } | null = null;
  if (itemCode) {
    item = await db.storeItem.findUnique({ where: { code: itemCode } });
    if (!item) return NextResponse.json({ error: 'ITEM_NOT_FOUND' }, { status: 404 });
  }
  if (boxCode) {
    box = await db.lootBoxDef.findUnique({ where: { code: boxCode } });
    if (!box) return NextResponse.json({ error: 'BOX_NOT_FOUND' }, { status: 404 });
  }

  const targets = all
    ? await db.user.findMany({ where: { isGuest: false }, select: { id: true } })
    : await db.user.findMany({ where: { usernameLower: username?.toLowerCase() ?? '' }, select: { id: true } });
  if (targets.length === 0) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });

  let count = 0;
  for (const t of targets) {
    await db.user.update({
      where: { id: t.id },
      data: { coins: coins ? { increment: coins } : undefined, xp: xp ? { increment: xp } : undefined },
    });
    if (item) {
      await db.purchase.upsert({
        where: { userId_itemId: { userId: t.id, itemId: item.code } },
        create: { userId: t.id, itemId: item.code, price: 0 },
        update: {},
      });
    }
    if (box) await db.boxGrant.create({ data: { userId: t.id, boxCode: box.code, source: all ? 'ADMIN' : 'GIFT' } });
    count++;
  }

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'GIFT',
      targetId: all ? 'ALL' : targets[0].id,
      details: JSON.stringify({ count, coins, xp, itemCode, boxCode, note }),
    },
  });

  return NextResponse.json({ ok: true, count });
}
