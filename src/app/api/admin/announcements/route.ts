import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { filterText } from '@/lib/moderation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const rows = await db.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  return NextResponse.json({ announcements: rows });
}

const annSchema = z.object({
  titleFa: z.string().min(2).max(120), titleEn: z.string().min(2).max(120),
  titleAr: z.string().min(2).max(120), titleTr: z.string().min(2).max(120),
  bodyFa: z.string().min(2).max(500), bodyEn: z.string().min(2).max(500),
  bodyAr: z.string().min(2).max(500), bodyTr: z.string().min(2).max(500),
  kind: z.enum(['INFO', 'EVENT', 'WARNING']).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = annSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  // all four locales must pass the filter
  for (const [k, v] of Object.entries(body.data)) {
    if (typeof v !== 'string') continue;
    const f = await filterText(v);
    if (f.maxSeverity >= 2) return NextResponse.json({ error: 'BAD_TEXT', field: k, words: f.words }, { status: 400 });
  }
  const ann = await db.announcement.create({ data: { ...body.data, kind: body.data.kind ?? 'INFO' } });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'announce_create', details: ann.id } });
  return NextResponse.json({ ok: true, announcement: ann });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = z.object({ id: z.string(), active: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  await db.announcement.update({ where: { id: body.data.id }, data: { active: body.data.active } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
