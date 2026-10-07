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
  const status = url.searchParams.get('status');
  const where = status && ['OPEN', 'ACTIONED', 'DISMISSED'].includes(status) ? { status } : {};
  const reports = await db.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      reporter: { select: { username: true } },
      target: { select: { username: true, banned: true, banCount: true } },
    },
  });
  return NextResponse.json({ reports });
}

const actionSchema = z.object({
  reportId: z.string().min(5).max(40),
  action: z.enum(['ban7', 'banPerm', 'dismiss', 'note']),
  note: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = actionSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { reportId, action } = body.data;

  const report = await db.report.findUnique({ where: { id: reportId } });
  if (!report) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  if (action === 'ban7' || action === 'banPerm') {
    if (!report.targetId) return NextResponse.json({ error: 'NO_TARGET' }, { status: 400 });
    const target = await db.user.findUnique({ where: { id: report.targetId } });
    if (target?.role === 'ADMIN') return NextResponse.json({ error: 'ADMIN_TARGET' }, { status: 403 });
    const until = action === 'banPerm' ? null : new Date(Date.now() + 7 * 86_400_000);
    await db.user.update({
      where: { id: report.targetId },
      data: { banned: true, banReason: report.reason, bannedUntil: until, banCount: { increment: 1 } },
    });
    await db.session.deleteMany({ where: { userId: report.targetId } });
    await db.report.update({
      where: { id: reportId },
      data: { status: 'ACTIONED', adminNote: body.data.note ?? '', resolvedAt: new Date() },
    });
  } else if (action === 'dismiss') {
    await db.report.update({
      where: { id: reportId },
      data: { status: 'DISMISSED', adminNote: body.data.note ?? '', resolvedAt: new Date() },
    });
  } else {
    await db.report.update({ where: { id: reportId }, data: { adminNote: body.data.note ?? '' } });
  }

  await db.auditLog.create({
    data: { actorId: admin.id, action: `report_${action}`, targetId: report.targetId, details: report.id },
  });
  return NextResponse.json({ ok: true });
}
