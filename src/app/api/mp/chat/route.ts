import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { INTERNAL_SECRET } from '@/lib/constants';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Internal: socket service logs chat messages for moderation */
const schema = z.object({
  roomId: z.string().max(40).default(''),
  senderId: z.string().max(40),
  senderName: z.string().max(32),
  text: z.string().max(200),
  masked: z.boolean().default(false),
  flaggedWords: z.string().max(200).default(''),
});

export async function POST(req: Request) {
  if (req.headers.get('x-internal-key') !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  await db.chatLog.create({ data: body.data });
  return NextResponse.json({ ok: true });
}
