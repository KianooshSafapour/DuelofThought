import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { ACHIEVEMENTS } from '@/lib/game/content';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ achievements: ACHIEVEMENTS.map((a) => ({ ...a, progress: 0, unlockedAt: null, claimed: true })) });

  const rows = await db.userAchievement.findMany({ where: { userId: me.id } });
  const map = new Map(rows.map((r) => [r.achievementId, r]));

  // live metrics (same computation as gameplay.ts)
  const [kindWins, runWins, hardWins, onlineWins, itemsOwned, questsDone, drawCount] = await Promise.all([
    db.gameResult.count({ where: { endReason: 'KIND', OR: [{ AND: [{ p1Id: me.id }, { winner: 'P1' }] }, { AND: [{ p2Id: me.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { endReason: 'RUN', OR: [{ AND: [{ p1Id: me.id }, { winner: 'P1' }] }, { AND: [{ p2Id: me.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { aiLevel: 'HARD', endReason: { in: ['KIND', 'RUN'] }, OR: [{ AND: [{ p1Id: me.id }, { winner: 'P1' }] }, { AND: [{ p2Id: me.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { mode: 'ONLINE', OR: [{ AND: [{ p1Id: me.id }, { winner: 'P1' }] }, { AND: [{ p2Id: me.id }, { winner: 'P2' }] }] } }),
    db.purchase.count({ where: { userId: me.id } }),
    db.userQuest.count({ where: { userId: me.id, claimed: true } }),
    db.gameResult.count({ where: { winner: 'DRAW', OR: [{ p1Id: me.id }, { p2Id: me.id }] } }),
  ]);
  const metrics: Record<string, number> = {
    wins: me.wins, kindWins, runWins, games: me.gamesPlayed, onlineWins, onlineGames: onlineWins,
    hardWins, streakBest: me.bestStreak, itemsOwned, level: me.level, questsDone, draws: drawCount,
  };

  return NextResponse.json({
    achievements: ACHIEVEMENTS.map((a) => {
      const row = map.get(a.id);
      const val = Math.min(metrics[a.metric] ?? 0, a.goal);
      return {
        ...a,
        progress: row && row.unlockedAt ? a.goal : val,
        unlockedAt: row?.unlockedAt ?? null,
        claimed: true,
      };
    }),
  });
}
