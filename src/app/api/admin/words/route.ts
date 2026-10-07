import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { invalidateWordCache } from '@/lib/moderation';
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
  const words = await db.bannedWord.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  return NextResponse.json({ words });
}

const addSchema = z.object({ word: z.string().min(2).max(40), severity: z.number().int().min(1).max(3) });

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = addSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const word = body.data.word.trim().toLowerCase();
  if (/[\u0000-\u001f]/.test(word)) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const row = await db.bannedWord.upsert({
    where: { word },
    create: { word, severity: body.data.severity },
    update: { severity: body.data.severity },
  });
  invalidateWordCache();
  await db.auditLog.create({ data: { actorId: admin.id, action: 'word_add', details: `${word}:${body.data.severity}` } });
  return NextResponse.json({ ok: true, word: row });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  await db.bannedWord.delete({ where: { id } }).catch(() => undefined);
  invalidateWordCache();
  await db.auditLog.create({ data: { actorId: admin.id, action: 'word_delete', details: id } });
  return NextResponse.json({ ok: true });
}
