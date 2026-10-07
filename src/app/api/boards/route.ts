import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/boards — public list of PUBLISHED team-designed boards for the
 * play lobby (AI / local modes). No auth needed. Max 50, newest first.
 * Wire format: layout = number[] of length 63 (bottom-first rows, 0 = blank).
 */
export async function GET() {
  const rows = await db.boardDefModel.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { code: true, nameFa: true, nameEn: true, layout: true, plays: true },
  });

  const boards: { code: string; nameFa: string; nameEn: string; layout: number[]; plays: number }[] = [];
  for (const b of rows) {
    let layout: unknown;
    try { layout = JSON.parse(b.layout); } catch { continue; }
    if (!Array.isArray(layout) || layout.length !== 63) continue;
    if (!layout.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)) continue;
    boards.push({
      code: b.code,
      nameFa: b.nameFa,
      nameEn: b.nameEn,
      layout: layout as number[],
      plays: b.plays,
    });
  }

  return NextResponse.json(boards);
}
