import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { levelFromXp } from '@/lib/game/content';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

const cheatSchema = z.object({
  username: z.string().min(1),
  setLevel: z.number().int().min(1).max(99).optional(),
  setRating: z.number().int().min(100).max(4000).optional(),
  setCoins: z.number().int().min(0).max(1_000_000).optional(),
  unlockAchievements: z.boolean().optional(),
  clearBans: z.boolean().optional(),
});

/**
 * POST /api/admin/cheat — the developer cheat engine.
 * Direct stat mutation for QA/balance demos; every action is audit-logged.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const body = cheatSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { username, setLevel, setRating, setCoins, unlockAchievements, clearBans } = body.data;
  if (setLevel === undefined && setRating === undefined && setCoins === undefined && !unlockAchievements && !clearBans) {
    return NextResponse.json({ error: 'EMPTY' }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } });
  if (!target) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (setCoins !== undefined) data.coins = setCoins;
  if (setRating !== undefined) data.rating = setRating;
  if (setLevel !== undefined) {
    // derive the minimum XP for the requested level and keep level in sync
    let xp = 0;
    for (let l = 1; l < setLevel; l++) xp += 100 + (l - 1) * 60;
    data.xp = xp;
    data.level = setLevel;
  }
  if (clearBans) {
    data.banned = false;
    data.banReason = null;
    data.bannedUntil = null;
  }
  if (Object.keys(data).length > 0) await db.user.update({ where: { id: target.id }, data });

  let unlocked = 0;
  if (unlockAchievements) {
    const { ACHIEVEMENTS } = await import('@/lib/game/content');
    for (const a of ACHIEVEMENTS) {
      const cur = await db.userAchievement.findUnique({ where: { userId_achievementId: { userId: target.id, achievementId: a.id } } });
      if (!cur?.unlockedAt) {
        await db.userAchievement.upsert({
          where: { userId_achievementId: { userId: target.id, achievementId: a.id } },
          create: { userId: target.id, achievementId: a.id, progress: a.goal, unlockedAt: new Date() },
          update: { progress: a.goal, unlockedAt: cur?.unlockedAt ?? new Date() },
        });
        unlocked++;
      }
    }
  }

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'CHEAT',
      targetId: target.id,
      details: JSON.stringify({ setLevel, setRating, setCoins, unlockAchievements, clearBans, unlocked }),
    },
  });

  const updated = await db.user.findUnique({ where: { id: target.id }, select: { coins: true, xp: true, level: true, rating: true, banned: true } });
  return NextResponse.json({ ok: true, unlocked, user: updated });
}
