import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await db.announcement.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return NextResponse.json({ announcements: rows });
}
