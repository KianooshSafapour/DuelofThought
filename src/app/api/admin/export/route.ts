import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

/** minimal CSV cell escaping */
function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/admin/export?type=users|games  → CSV download (max 2000 rows).
 */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const type = new URL(req.url).searchParams.get('type') ?? 'users';
  let csv: string;
  let filename: string;

  if (type === 'games') {
    const rows = await db.gameResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, mode: true, ranked: true, boardId: true, winner: true, endReason: true,
        p1Name: true, p2Name: true, aiLevel: true, moves: true, durationMs: true,
        p1RatingDelta: true, p2RatingDelta: true, coinsAwarded: true, xpAwarded: true, createdAt: true,
      },
    });
    csv = [
      'id,mode,ranked,board,winner,end_reason,p1,p2,ai,moves,duration_ms,p1_elo,p2_elo,coins,xp,created_at',
      ...rows.map((r) =>
        [r.id, r.mode, r.ranked, r.boardId, r.winner, r.endReason, r.p1Name, r.p2Name, r.aiLevel ?? '', r.moves, r.durationMs, r.p1RatingDelta, r.p2RatingDelta, r.coinsAwarded, r.xpAwarded, r.createdAt.toISOString()].map(esc).join(','),
      ),
    ].join('\n');
    filename = `duel-games-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    const rows = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true, username: true, role: true, isGuest: true, banned: true, banReason: true,
        coins: true, xp: true, level: true, rating: true, wins: true, losses: true, draws: true,
        gamesPlayed: true, bestStreak: true, locale: true, bio: true, createdAt: true, lastSeen: true,
      },
    });
    csv = [
      'id,username,role,guest,banned,ban_reason,coins,xp,level,rating,wins,losses,draws,games,best_streak,locale,bio,created_at,last_seen',
      ...rows.map((r) =>
        [r.id, r.username, r.role, r.isGuest, r.banned, r.banReason ?? '', r.coins, r.xp, r.level, r.rating, r.wins, r.losses, r.draws, r.gamesPlayed, r.bestStreak, r.locale, r.bio.replace(/\n/g, ' '), r.createdAt.toISOString(), r.lastSeen.toISOString()].map(esc).join(','),
      ),
    ].join('\n');
    filename = `duel-users-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  await db.auditLog.create({
    data: { actorId: admin.id, action: 'export_csv', targetId: null, details: `type=${type} rows=${csv.split('\n').length - 1}` },
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
