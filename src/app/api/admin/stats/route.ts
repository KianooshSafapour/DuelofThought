import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const d14 = new Date(now.getTime() - 14 * 86_400_000);

  const [totalUsers, activeToday, totalGames, gamesToday, openReports, guests, bannedUsers, onlineNow] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { lastSeen: { gte: dayAgo } } }),
    db.gameResult.count(),
    db.gameResult.count({ where: { createdAt: { gte: dayAgo } } }),
    db.report.count({ where: { status: 'OPEN' } }),
    db.user.count({ where: { isGuest: true } }),
    db.user.count({ where: { banned: true } }),
    db.user.count({ where: { lastSeen: { gte: new Date(now.getTime() - 5 * 60_000) } } }),
  ]);

  // games per day (14d)
  const recent = await db.gameResult.findMany({ where: { createdAt: { gte: d14 } }, select: { createdAt: true, mode: true, endReason: true, winner: true, moves: true, firstMoveCol: true } });
  const perDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    perDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const g of recent) {
    const k = g.createdAt.toISOString().slice(0, 10);
    if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }

  const winTypes = { KIND: 0, RUN: 0, FULL: 0, RESIGN: 0, TIMEOUT: 0 };
  const modeDist = { PVE: 0, LOCAL_PVP: 0, ONLINE: 0 };
  const firstMove = new Array(9).fill(0);
  let movesSum = 0;
  for (const g of recent) {
    winTypes[g.endReason as keyof typeof winTypes] = (winTypes[g.endReason as keyof typeof winTypes] ?? 0) + 1;
    modeDist[g.mode as keyof typeof modeDist] = (modeDist[g.mode as keyof typeof modeDist] ?? 0) + 1;
    if (g.firstMoveCol >= 0 && g.firstMoveCol < 9) firstMove[g.firstMoveCol]++;
    movesSum += g.moves;
  }

  // number capture heatmap (which numbers players chase)
  const events = await db.analyticsEvent.findMany({
    where: { type: { in: ['game_pve', 'game_online', 'game_local_pvp'] }, createdAt: { gte: d14 } },
    select: { payload: true },
    take: 2000,
  });
  const winNumbersSeen: Record<number, number> = {};
  for (const e of events) {
    try {
      const p = JSON.parse(e.payload) as { winType?: string };
      void p;
    } catch { /* skip */ }
  }

  const [topItems, purchaseCount, coinsMinted, coinSpent] = await Promise.all([
    db.storeItem.findMany({ orderBy: { sales: 'desc' }, take: 6, select: { code: true, category: true, sales: true, price: true } }),
    db.purchase.count({ where: { price: { gt: 0 } } }),
    db.gameResult.aggregate({ _sum: { coinsAwarded: true } }),
    db.purchase.aggregate({ where: { price: { gt: 0 } }, _sum: { price: true } }),
  ]);

  return NextResponse.json({
    cards: { totalUsers, activeToday, totalGames, gamesToday, openReports, guests, bannedUsers, onlineNow },
    charts: {
      gamesPerDay: [...perDay.entries()].map(([date, count]) => ({ date, count })),
      winTypes, modeDist, firstMove,
      avgMoves: recent.length ? Math.round((movesSum / recent.length) * 10) / 10 : 0,
    },
    economy: {
      purchases: purchaseCount,
      coinsMinted: coinsMinted._sum.coinsAwarded ?? 0,
      coinsSpent: coinSpent._sum.price ?? 0,
      topItems,
    },
  });
}
