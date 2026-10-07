import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { applyGameResult, recordGameResult } from '@/lib/gameplay';
import { getBoard, setCustomBoards } from '@/lib/game/boards';
import { createGame, applyMove, TOTAL } from '@/lib/game/engine';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/**
 * Idempotency: identical submissions (same user + mode + board + exact move
 * sequence) within a 10-minute window are rejected. Blocks double-reward
 * exploits (e.g. re-submitting the same replay) while allowing legit repeats
 * of a winning strategy after the window passes.
 */
const recentSigs = new Map<string, number>();
const SIG_TTL_MS = 10 * 60_000;
let sigSweptAt = 0;
function isDuplicateSig(sig: string): boolean {
  const now = Date.now();
  if (now - sigSweptAt > 60_000) { // cheap hourly-ish sweep
    for (const [k, t] of recentSigs) if (now - t > SIG_TTL_MS) recentSigs.delete(k);
    sigSweptAt = now;
  }
  const seen = recentSigs.get(sig);
  if (seen && now - seen < SIG_TTL_MS) return true;
  recentSigs.set(sig, now);
  return false;
}

/**
 * Submit a finished PVE or LOCAL_PVP game. Server re-plays the move history to
 * verify the claimed outcome (anti-cheat). Online games are refereed by the
 * socket service and reported via /api/mp/result instead.
 */
const schema = z.object({
  mode: z.enum(['PVE', 'LOCAL_PVP']),
  // max 25: custom team boards use "c" + code (code up to 24 chars)
  boardId: z.string().min(1).max(25),
  aiLevel: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  endReason: z.enum(['KIND', 'RUN', 'FULL', 'RESIGN', 'TIMEOUT']),
  winner: z.enum(['P1', 'P2', 'DRAW']),
  winNumbers: z.array(z.number().int().min(1).max(9)).max(4).optional(),
  history: z.array(z.number().int().min(0).max(8)).max(TOTAL),
  durationMs: z.number().int().min(0).max(4 * 3600_000),
  opponentName: z.string().max(32).optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(user)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`submit:${user.id}`, 40, 3600_000) || !rateLimit(`submitIp:${clientIp(req)}`, 60, 3600_000)) {
    return NextResponse.json({ error: 'RATE' }, { status: 429 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const d = parsed.data;

  /* ---------- custom (admin-designed) board injection ----------
   * Team boards are addressed as "c<code>"; getBoard is synchronous, so the
   * real layout is loaded from the DB and pushed into the cache first.
   * Published OR not — staff designs stay playable while being tuned. */
  const customMatch = /^c([a-z0-9-]+)$/.exec(d.boardId);
  if (customMatch) {
    const def = await db.boardDefModel.findUnique({ where: { code: customMatch[1] } }).catch(() => null);
    if (!def) return NextResponse.json({ error: 'BOARD_NOT_FOUND' }, { status: 404 });
    let layout: unknown;
    try { layout = JSON.parse(def.layout); } catch { layout = null; }
    if (!Array.isArray(layout) || layout.length !== 63) {
      return NextResponse.json({ error: 'BOARD_NOT_FOUND' }, { status: 404 });
    }
    setCustomBoards([{ code: def.code, layout: layout as number[] }]);
  }

  /* ---------- server-side replay validation ---------- */
  let moves = d.history.length;
  let firstMoveCol = d.history.length > 0 ? d.history[0] : -1;
  let replayWin: { winner: 'P1' | 'P2'; type: 'KIND' | 'RUN'; numbers: number[] } | null = null;
  try {
    const board = getBoard(d.boardId);
    const st = createGame(board.numbers, board.id);
    for (const col of d.history) {
      if (applyMove(st, col) < 0) return NextResponse.json({ error: 'CORRUPT_HISTORY' }, { status: 409 });
    }
    moves = st.ply;
    if (st.result && st.result.winner !== 0 && (st.result.type === 'KIND' || st.result.type === 'RUN')) {
      replayWin = { winner: st.result.winner === 1 ? 'P1' : 'P2', type: st.result.type, numbers: st.result.numbers };
    }
    if (d.boardId !== board.id) d.boardId = board.id;
  } catch {
    return NextResponse.json({ error: 'CORRUPT_HISTORY' }, { status: 409 });
  }

  /* claimed outcome must match the replay */
  if (d.endReason === 'KIND' || d.endReason === 'RUN') {
    if (!replayWin || replayWin.winner !== d.winner || replayWin.type !== d.endReason) {
      return NextResponse.json({ error: 'OUTCOME_MISMATCH' }, { status: 409 });
    }
  } else if (replayWin) {
    return NextResponse.json({ error: 'OUTCOME_MISMATCH' }, { status: 409 });
  }

  const winType = replayWin?.type ?? null;
  const winNumbers = replayWin?.numbers ?? d.winNumbers ?? [];

  /* PVE: the human is always P1 */
  const userOutcome: 'WIN' | 'LOSS' | 'DRAW' =
    d.mode === 'PVE'
      ? d.winner === 'P1' ? 'WIN' : d.winner === 'P2' ? 'LOSS' : 'DRAW'
      : d.winner === 'DRAW' ? 'DRAW' : 'WIN'; // local pvp: requester is the host; both sides same account

  /* sanity: a win needs at least 4 own pieces → earliest legit final ply is 7
   * (P1 drops on plies 1,3,5,7). Anything shorter is impossible — block it. */
  if (userOutcome === 'WIN' && moves < 7) {
    return NextResponse.json({ error: 'OUTCOME_MISMATCH' }, { status: 409 });
  }

  /* duplicate-submission guard (same replay = same signature) */
  const sig = createHash('sha256')
    .update(`${user.id}|${d.mode}|${d.boardId}|${d.history.join(',')}`)
    .digest('hex');
  if (isDuplicateSig(sig)) {
    return NextResponse.json({ error: 'DUPLICATE' }, { status: 409 });
  }

  try {
    const result = await applyGameResult({
      userId: user.id,
      mode: d.mode,
      outcome: userOutcome,
      aiLevel: d.aiLevel,
      winType,
      moves,
      durationMs: d.durationMs,
      boardId: d.boardId,
      firstMoveCol,
      endReason: d.endReason,
      movesSummary: { history: d.history },
    });

    // team-board play counter (fire & forget — must never block the reward)
    if (customMatch) {
      db.boardDefModel.update({ where: { code: customMatch[1] }, data: { plays: { increment: 1 } } }).catch(() => undefined);
    }

    await recordGameResult({
      mode: d.mode, ranked: false, boardId: d.boardId,
      winner: d.winner, endReason: d.endReason, winNumbers,
      p1Id: d.mode === 'PVE' ? user.id : user.id,
      p2Id: null, aiLevel: d.aiLevel ?? null,
      p1Name: user.username, p2Name: d.opponentName ?? (d.mode === 'PVE' ? `AI (${d.aiLevel ?? 'MEDIUM'})` : 'P2'),
      moves, firstMoveCol, durationMs: d.durationMs,
      movesData: { awards: { [user.id]: result.coins }, history: d.history },
      coinsAwarded: result.coins, xpAwarded: result.xp,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('submit error', e);
    return NextResponse.json({ error: 'SERVER' }, { status: 500 });
  }
}
