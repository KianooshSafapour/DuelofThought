import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/game/replay?id=<gameResultId>
 * Returns the stored move sequence of a finished game for the replay viewer.
 * Only participants (or admins) may watch a replay.
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (!rateLimit(`replay:${me.id}`, 60, 3600_000)) {
    return NextResponse.json({ error: 'RATE' }, { status: 429 });
  }

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[a-z0-9]{8,40}$/i.test(id)) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const g = await db.gameResult.findUnique({
    where: { id },
    select: {
      id: true, mode: true, boardId: true, winner: true, endReason: true, winNumbers: true,
      p1Id: true, p2Id: true, p1Name: true, p2Name: true, aiLevel: true,
      moves: true, durationMs: true, movesData: true, createdAt: true,
      p1RatingDelta: true, p2RatingDelta: true,
    },
  });
  if (!g) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const isParticipant = g.p1Id === me.id || g.p2Id === me.id;
  if (!isParticipant && me.role !== 'ADMIN') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let history: number[] = [];
  try {
    const md = JSON.parse(g.movesData) as { history?: unknown };
    if (Array.isArray(md.history)) {
      history = md.history.filter((m): m is number => typeof m === 'number' && m >= 0 && m <= 8).slice(0, 63);
    }
  } catch { /* legacy rows without history */ }

  return NextResponse.json({
    id: g.id,
    mode: g.mode,
    boardId: g.boardId,
    winner: g.winner,
    endReason: g.endReason,
    winNumbers: JSON.parse(g.winNumbers || '[]') as number[],
    p1Name: g.p1Name,
    p2Name: g.p2Name,
    p1Id: g.p1Id,
    p2Id: g.p2Id,
    aiLevel: g.aiLevel,
    moves: g.moves,
    durationMs: g.durationMs,
    createdAt: g.createdAt,
    p1RatingDelta: g.p1RatingDelta,
    p2RatingDelta: g.p2RatingDelta,
    history,
    /** older rows only stored the last 20 plies */
    partial: history.length > 0 && history.length < g.moves,
  });
}
