import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { ARCADE_GAMES, ARCADE_CAPS, ARCADE_SCORE_CEIL, arcadeRewards, arcadeRewardsV2, levelFromXp, type ArcadeGame } from '@/lib/game/content';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** GET /api/arcade?game=orbit — top scores + my bests (shared cross-game economy) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const game = url.searchParams.get('game') ?? '';
  const me = await currentUser();
  if (!ARCADE_GAMES.includes(game as ArcadeGame)) return NextResponse.json({ error: 'INVALID_GAME' }, { status: 400 });

  const [top, myBest, myPlays] = await Promise.all([
    db.arcadeScore.findMany({
      where: { game },
      orderBy: [{ score: 'desc' }],
      take: 10,
      distinct: ['userId'],
      include: { user: { select: { id: true, username: true, avatarItem: true, level: true, titleItem: true } } },
    }),
    me ? db.arcadeScore.findFirst({ where: { userId: me.id, game }, orderBy: [{ score: 'desc' }] }) : Promise.resolve(null),
    me ? db.arcadeScore.count({ where: { userId: me.id, game } }) : Promise.resolve(0),
  ]);

  return NextResponse.json({
    top: top.map((t, i) => ({ rank: i + 1, score: t.score, meta: t.meta, createdAt: t.createdAt, user: t.user })),
    myBest: myBest ? { score: myBest.score, meta: myBest.meta } : null,
    myPlays,
  });
}

const submitSchema = z.object({
  game: z.enum(['orbit', 'synapse', 'stellar', 'mazemind', 'boulderyard', 'boulderyard2', 'cheese']),
  score: z.number().int().min(0).max(1_000_000),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** POST /api/arcade — submit a finished arcade run (server-side sanity + caps) */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`arcade:${me.id}`, 40, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = submitSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const game = body.data.game as ArcadeGame;
  const score = Math.min(body.data.score, ARCADE_SCORE_CEIL[game]); // clamp implausible scores

  /* per-game hourly anti-farm cap */
  const hourAgo = new Date(Date.now() - 3600_000);
  const earned = await db.arcadeScore.aggregate({
    where: { userId: me.id, game, createdAt: { gte: hourAgo } },
    _sum: { coinsAwarded: true },
  });
  const capLeft = Math.max(0, ARCADE_CAPS[game] - (earned._sum.coinsAwarded ?? 0));
  const base = game === 'mazemind' || game === 'boulderyard' || game === 'boulderyard2' || game === 'cheese' ? arcadeRewardsV2(game, score) : arcadeRewards(game, score);
  const coins = Math.min(base.coins, capLeft);
  const xp = base.xp;

  const newXp = me.xp + xp;
  const newLevel = levelFromXp(newXp).level;

  const [, user2] = await Promise.all([
    db.arcadeScore.create({
      data: {
        userId: me.id, game, score,
        meta: JSON.stringify(body.data.meta ?? {}),
        coinsAwarded: coins, xpAwarded: xp,
      },
    }),
    db.user.update({
      where: { id: me.id },
      data: { coins: { increment: coins }, xp: newXp, level: newLevel, lastSeen: new Date() },
    }),
    db.analyticsEvent.create({ data: { userId: me.id, type: `arcade_${game}`, payload: JSON.stringify({ score, ...body.data.meta }) } }),
  ]);

  /* daily quest bump: arcadeGames (create quests first if missing) */
  const dk = dateKeyTehran();
  const questDefs = (await import('@/lib/game/content')).questsForDay(dk, me.id).filter((q) => q.metric === 'arcadeGames');
  const completed: { id: string; reward: number }[] = [];
  for (const q of questDefs) {
    await db.userQuest.upsert({
      where: { userId_questId_dateKey: { userId: me.id, questId: q.id, dateKey: dk } },
      create: { userId: me.id, questId: q.id, dateKey: dk, goal: q.goal, reward: q.reward, progress: 1 },
      update: { progress: { increment: 1 } },
    });
    const row = await db.userQuest.findUnique({ where: { userId_questId_dateKey: { userId: me.id, questId: q.id, dateKey: dk } } });
    if (row && row.progress >= row.goal) completed.push({ id: q.id, reward: q.reward });
  }

  /* achievements: arcadeGames */
  const achUnlocked: { id: string; coins: number; rarity: string }[] = [];
  const plays = await db.arcadeScore.count({ where: { userId: me.id } });
  const achDefs = [
    { id: 'arcade_1', goal: 1, coins: 60, rarity: 'COMMON' },
    { id: 'arcade_10', goal: 10, coins: 200, rarity: 'RARE' },
    { id: 'arcade_30', goal: 30, coins: 420, rarity: 'EPIC' },
  ];
  for (const a of achDefs) {
    if (plays >= a.goal) {
      const cur = await db.userAchievement.findUnique({ where: { userId_achievementId: { userId: me.id, achievementId: a.id } } });
      if (!cur || !cur.unlockedAt) {
        await db.userAchievement.upsert({
          where: { userId_achievementId: { userId: me.id, achievementId: a.id } },
          create: { userId: me.id, achievementId: a.id, progress: a.goal, unlockedAt: new Date() },
          update: { progress: a.goal, unlockedAt: cur?.unlockedAt ?? new Date() },
        });
        if (!cur) {
          achUnlocked.push({ id: a.id, coins: a.coins, rarity: a.rarity });
          await db.user.update({ where: { id: me.id }, data: { coins: { increment: a.coins } } });
        }
      }
    } else {
      await db.userAchievement.upsert({
        where: { userId_achievementId: { userId: me.id, achievementId: a.id } },
        create: { userId: me.id, achievementId: a.id, progress: plays },
        update: { progress: plays },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    coins,
    xp,
    clamped: score < body.data.score,
    levelUps: Math.max(0, newLevel - me.level),
    completedQuests: completed,
    unlockedAchievements: achUnlocked,
    user: { coins: user2.coins, xp: user2.xp, level: user2.level },
  });
}

function dateKeyTehran(now = new Date()): string {
  const t = new Date(now.getTime() + 3.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
