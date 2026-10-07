import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { applyGameResult, recordGameResult } from '@/lib/gameplay';
import { INTERNAL_SECRET } from '@/lib/constants';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Internal: the socket referee reports a finished online game here. */
const schema = z.object({
  roomId: z.string().min(4).max(40),
  boardId: z.string().min(1).max(24),
  ranked: z.boolean(),
  endReason: z.enum(['KIND', 'RUN', 'FULL', 'RESIGN', 'TIMEOUT']),
  winNumbers: z.array(z.number().int()).max(4),
  p1: z.object({ id: z.string(), name: z.string(), rating: z.number() }),
  p2: z.object({ id: z.string(), name: z.string(), rating: z.number() }),
  winner: z.enum(['P1', 'P2', 'DRAW']),
  moves: z.number().int().min(0).max(63),
  history: z.array(z.number().int().min(0).max(8)).max(63),
  firstMoveCol: z.number().int().min(-1).max(8),
  durationMs: z.number().int().min(0),
});

function outcomeOf(winner: string, side: 'P1' | 'P2'): 'WIN' | 'LOSS' | 'DRAW' {
  if (winner === 'DRAW') return 'DRAW';
  return winner === side ? 'WIN' : 'LOSS';
}

export async function POST(req: Request) {
  if (req.headers.get('x-internal-key') !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const d = body.data;

  // idempotency: a roomId is reported exactly once
  const already = await db.analyticsEvent.findFirst({
    where: { type: 'mp_result', payload: { contains: d.roomId } },
  });
  if (already) return NextResponse.json({ ok: true, duplicate: true });

  const winType = d.endReason === 'KIND' || d.endReason === 'RUN' ? d.endReason : null;

  const [r1, r2] = await Promise.all([
    applyGameResult({
      userId: d.p1.id, mode: 'ONLINE', ranked: d.ranked,
      outcome: outcomeOf(d.winner, 'P1'), winType,
      moves: d.moves, durationMs: d.durationMs, boardId: d.boardId,
      firstMoveCol: d.firstMoveCol, endReason: d.endReason,
      opponentId: d.p2.id, opponentRating: d.p2.rating, userRating: d.p1.rating,
    }),
    applyGameResult({
      userId: d.p2.id, mode: 'ONLINE', ranked: d.ranked,
      outcome: outcomeOf(d.winner, 'P2'), winType,
      moves: d.moves, durationMs: d.durationMs, boardId: d.boardId,
      firstMoveCol: d.firstMoveCol, endReason: d.endReason,
      opponentId: d.p1.id, opponentRating: d.p1.rating, userRating: d.p2.rating,
    }),
  ]);

  await recordGameResult({
    mode: 'ONLINE', ranked: d.ranked, boardId: d.boardId, winner: d.winner,
    endReason: d.endReason, winNumbers: d.winNumbers,
    p1Id: d.p1.id, p2Id: d.p2.id,
    p1Name: d.p1.name, p2Name: d.p2.name,
    moves: d.moves, firstMoveCol: d.firstMoveCol, durationMs: d.durationMs,
    movesData: { awards: { [d.p1.id]: r1.coins, [d.p2.id]: r2.coins }, roomId: d.roomId, history: d.history },
    p1RatingDelta: r1.eloDelta ?? 0, p2RatingDelta: r2.eloDelta ?? 0,
    coinsAwarded: r1.coins, xpAwarded: r1.xp,
  });

  await db.analyticsEvent.create({
    data: { type: 'mp_result', payload: JSON.stringify({ roomId: d.roomId, winner: d.winner, endReason: d.endReason }) },
  });

  return NextResponse.json({
    ok: true,
    p1: r1, p2: r2,
  });
}
