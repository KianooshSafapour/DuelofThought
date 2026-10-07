import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  const target = userId ?? me.id;

  const rows = await db.gameResult.findMany({
    where: { OR: [{ p1Id: target }, { p2Id: target }], mode: { not: 'LOCAL_PVP' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, mode: true, winner: true, endReason: true, boardId: true, moves: true,
      p1Id: true, p2Id: true, p1Name: true, p2Name: true, aiLevel: true,
      p1RatingDelta: true, p2RatingDelta: true, createdAt: true, durationMs: true,
    },
  });
  return NextResponse.json({
    games: rows.map((r) => ({
      ...r,
      youWon: (r.p1Id === target && r.winner === 'P1') || (r.p2Id === target && r.winner === 'P2'),
      draw: r.winner === 'DRAW',
      createdAt: r.createdAt,
    })),
  });
}
