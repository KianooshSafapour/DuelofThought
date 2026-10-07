import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { INTERNAL_SECRET } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Internal: word list for the socket chat filter */
export async function GET(req: Request) {
  if (req.headers.get('x-internal-key') !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const words = await db.bannedWord.findMany({ select: { word: true, severity: true } });
  return NextResponse.json({ words });
}
