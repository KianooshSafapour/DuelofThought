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

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(req.url);
  const view = url.searchParams.get('view');

  if (view === 'chats') {
    const flagged = url.searchParams.get('flagged') === '1';
    const chats = await db.chatLog.findMany({
      where: flagged ? { masked: true } : {},
      orderBy: { createdAt: 'desc' },
      take: 120,
      include: { sender: { select: { username: true, banned: true } } },
    });
    return NextResponse.json({ chats });
  }

  if (view === 'audit') {
    const logs = await db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { actor: { select: { username: true } } },
    });
    return NextResponse.json({ logs });
  }

  const [items, salesAgg] = await Promise.all([
    db.storeItem.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.purchase.groupBy({ by: ['itemId'], _count: { itemId: true } }),
  ]);
  const salesMap = new Map(salesAgg.map((s) => [s.itemId, s._count.itemId]));
  return NextResponse.json({
    items: items.map((i) => ({ ...i, data: JSON.parse(i.data), purchasedBy: salesMap.get(i.code) ?? 0 })),
  });
}

const itemSchema = z.object({
  code: z.string().min(2).max(40),
  price: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
  requiredLevel: z.number().int().min(1).max(50).optional(),
  rarity: z.enum(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']).optional(),
});

/** Admin can tune prices / availability; new item creation is limited to price/flag tuning for safety. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = itemSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { code, ...patch } = body.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'NOTHING' }, { status: 400 });
  const item = await db.storeItem.update({ where: { code }, data: patch }).catch(() => null);
  if (!item) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'item_update', details: `${code}:${JSON.stringify(patch)}` } });
  return NextResponse.json({ ok: true, item });
}
