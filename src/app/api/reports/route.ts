import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  targetName: z.string().min(1).max(32),
  reason: z.enum(['INSULT', 'CHEAT', 'SPAM', 'NAME', 'OTHER']),
  details: z.string().max(500).optional(),
  chatExcerpt: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`report:${me.id}`, 10, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = reportSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const target = await db.user.findFirst({
    where: { OR: [{ username: body.data.targetName }, { usernameLower: body.data.targetName.toLowerCase() }] },
  });

  const report = await db.report.create({
    data: {
      reporterId: me.id,
      targetId: target?.id ?? null,
      targetName: body.data.targetName.slice(0, 32),
      reason: body.data.reason,
      details: (body.data.details ?? '').slice(0, 500),
      chatExcerpt: (body.data.chatExcerpt ?? '').slice(0, 300),
    },
  });
  return NextResponse.json({ ok: true, id: report.id });
}
