import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** Escalating daily rewards: day 1..7 (day 7 = big bonus). */
export const CHECKIN_REWARDS = [40, 60, 80, 100, 140, 180, 300] as const;

/** Tehran-local calendar date key (same convention as quests route). */
function dateKeyTehran(now = new Date()): string {
  const t = new Date(now.getTime() + 3.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function yesterdayKeyTehran(): string {
  return dateKeyTehran(new Date(Date.now() - 24 * 3600 * 1000));
}

/** GET → current check-in status for the signed-in user. */
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ auth: false });
  const today = dateKeyTehran();
  const claimedToday = me.lastCheckin === today;
  const streak = me.checkinStreak;
  // reward slot (1..7) of the NEXT claim — the table repeats every 7 days
  const nextDay = claimedToday ? ((streak - 1) % 7) + 1 : (streak % 7) + 1;
  return NextResponse.json({
    auth: true,
    claimedToday,
    streak,
    nextDay,
    nextReward: CHECKIN_REWARDS[nextDay - 1],
    rewards: CHECKIN_REWARDS,
  });
}

/** POST → claim today's reward (streak continues if last claim was yesterday). */
export async function POST() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`checkin:${me.id}`, 6, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const today = dateKeyTehran();
  if (me.lastCheckin === today) return NextResponse.json({ error: 'ALREADY' }, { status: 409 });

  const continues = me.lastCheckin === yesterdayKeyTehran();
  const nextStreak = continues ? Math.min(me.checkinStreak + 1, 999) : 1;
  const daySlot = ((nextStreak - 1) % 7); // 0-based; day 8 → slot 0 again but streak keeps growing
  const reward = CHECKIN_REWARDS[daySlot];

  const user2 = await db.user.update({
    where: { id: me.id },
    data: { coins: { increment: reward }, checkinStreak: nextStreak, lastCheckin: today },
  });
  await db.analyticsEvent.create({
    data: { userId: me.id, type: 'checkin', payload: JSON.stringify({ day: nextStreak, reward, streakReset: !continues }) },
  });

  return NextResponse.json({ ok: true, reward, streak: nextStreak, coins: user2.coins, jackpot: daySlot === 6 });
}
