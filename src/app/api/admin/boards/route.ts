import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { boardIsSound } from '@/lib/game/boards';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

const CODE_RE = /^[a-z0-9-]{3,24}$/;

/** layout wire format: exactly 63 ints 0..9 (0 = blank cell), bottom-first rows */
const layoutSchema = z
  .array(z.number().int().min(0).max(9))
  .length(63);

const createSchema = z.object({
  code: z.string().regex(CODE_RE),
  nameFa: z.string().max(40).optional(),
  nameEn: z.string().max(40).optional(),
  layout: layoutSchema,
  published: z.boolean().optional(),
});

const patchSchema = z.object({
  code: z.string().min(3).max(24),
  nameFa: z.string().max(40).optional(),
  nameEn: z.string().max(40).optional(),
  layout: layoutSchema.optional(),
  published: z.boolean().optional(),
});

/** Persian-friendly explanation sent alongside machine error keys */
const NOT_SOUND_MSG =
  'جدول سالم نیست: طول باید ۶۳ خانه باشد و هر عدد ۱ تا ۹ دست‌کم ۴ بار دیده شود (خانه‌های خالی خیلی زیاد نباشند) · ' +
  'Board is not sound: length must be 63 and every number 1–9 must appear at least 4 times (not too many blanks).';

function layoutToNumbers(layout: number[]): (number | null)[] {
  return layout.map((v) => (v === 0 ? null : v));
}

/** GET /api/admin/boards — every board (published or not) + author + play count */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const rows = await db.boardDefModel.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { username: true } } },
  });
  const boards = rows.map((b) => {
    let layout: number[] = [];
    try {
      const parsed: unknown = JSON.parse(b.layout);
      if (Array.isArray(parsed) && parsed.length === 63) layout = parsed as number[];
    } catch { /* keep empty — editor shows a blank grid */ }
    return {
      id: b.id,
      code: b.code,
      nameFa: b.nameFa,
      nameEn: b.nameEn,
      layout,
      published: b.published,
      plays: b.plays,
      author: b.author?.username ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  });
  return NextResponse.json({ boards });
}

/** POST /api/admin/boards — create a new board design */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { code, nameFa, nameEn, layout, published } = body.data;

  const dup = await db.boardDefModel.findUnique({ where: { code } });
  if (dup) return NextResponse.json({ error: 'DUP_CODE' }, { status: 409 });

  if (!boardIsSound(layoutToNumbers(layout))) {
    return NextResponse.json({ error: 'NOT_SOUND', message: NOT_SOUND_MSG }, { status: 400 });
  }

  const board = await db.boardDefModel.create({
    data: {
      code,
      nameFa: nameFa ?? '',
      nameEn: nameEn ?? '',
      layout: JSON.stringify(layout),
      published: published ?? false,
      createdBy: admin.id,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'board_create',
      targetId: board.id,
      details: JSON.stringify({ code, published: board.published, blanks: layout.filter((v) => v === 0).length }),
    },
  });

  return NextResponse.json({ ok: true, board: { id: board.id, code: board.code } });
}

/** PATCH /api/admin/boards — rename / retune layout / publish-toggle */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { code, nameFa, nameEn, layout, published } = body.data;

  const board = await db.boardDefModel.findUnique({ where: { code } });
  if (!board) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const data: { nameFa?: string; nameEn?: string; layout?: string; published?: boolean } = {};
  if (nameFa !== undefined) data.nameFa = nameFa;
  if (nameEn !== undefined) data.nameEn = nameEn;
  if (published !== undefined) data.published = published;
  if (layout !== undefined) {
    if (!boardIsSound(layoutToNumbers(layout))) {
      return NextResponse.json({ error: 'NOT_SOUND', message: NOT_SOUND_MSG }, { status: 400 });
    }
    data.layout = JSON.stringify(layout);
  }

  const updated = await db.boardDefModel.update({ where: { code }, data });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'board_update',
      targetId: updated.id,
      details: JSON.stringify({ code, fields: Object.keys(data) }),
    },
  });

  return NextResponse.json({ ok: true, board: { id: updated.id, code: updated.code, published: updated.published } });
}

/** DELETE /api/admin/boards?code= — remove a design permanently */
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!CODE_RE.test(code)) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const board = await db.boardDefModel.delete({ where: { code } }).catch(() => null);
  if (!board) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await db.auditLog.create({
    data: { actorId: admin.id, action: 'board_delete', targetId: board.id, details: code },
  });

  return NextResponse.json({ ok: true });
}
