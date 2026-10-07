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

/** GET /api/admin/boxes — every chest with its full drop pool + open stats */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const boxes = await db.lootBoxDef.findMany({
    include: { drops: { orderBy: [{ kind: 'asc' }, { weight: 'desc' }] } },
    orderBy: { price: 'asc' },
  });
  return NextResponse.json({ boxes });
}

const patchSchema = z.object({
  dropId: z.string().min(5),
  weight: z.number().int().min(0).max(1000).optional(),
  amount: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

const addSchema = z.object({
  boxCode: z.string().min(3),
  kind: z.enum(['COINS', 'XP', 'ITEM']),
  itemCode: z.string().optional(),
  amount: z.number().int().min(0).max(1_000_000),
  weight: z.number().int().min(1).max(1000),
});

const delSchema = z.object({ dropId: z.string().min(5) });

/** POST /api/admin/boxes — add a drop entry */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = addSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const box = await db.lootBoxDef.findUnique({ where: { code: body.data.boxCode } });
  if (!box) return NextResponse.json({ error: 'BOX_NOT_FOUND' }, { status: 404 });
  if (body.data.kind === 'ITEM' && !body.data.itemCode) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const drop = await db.lootBoxDrop.create({
    data: { boxCode: box.code, kind: body.data.kind, itemCode: body.data.itemCode ?? null, amount: body.data.amount, weight: body.data.weight },
  });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'BOX_DROP_ADD', targetId: box.code, details: JSON.stringify(body.data) } });
  return NextResponse.json({ ok: true, drop });
}

/** PATCH /api/admin/boxes — retune weight/amount/active */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { dropId, ...rest } = body.data;
  const drop = await db.lootBoxDrop.update({ where: { id: dropId }, data: rest });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'BOX_DROP_TUNE', targetId: drop.boxCode, details: JSON.stringify(rest) } });
  return NextResponse.json({ ok: true, drop });
}

/** DELETE /api/admin/boxes?id=dropId */
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const dropId = new URL(req.url).searchParams.get('id') ?? '';
  const body = delSchema.safeParse({ dropId });
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const drop = await db.lootBoxDrop.delete({ where: { id: dropId } }).catch(() => null);
  if (!drop) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'BOX_DROP_DEL', targetId: drop.boxCode, details: dropId } });
  return NextResponse.json({ ok: true });
}
