import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { questsForDay, QUEST_POOL } from '@/lib/game/content';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

function dateKeyTehran(now = new Date()): string {
  const t = new Date(now.getTime() + 3.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ quests: [] });
  const dk = dateKeyTehran();
  const defs = questsForDay(dk, me.id);
  const rows = await Promise.all(defs.map(async (def) => {
    const row = await db.userQuest.upsert({
      where: { userId_questId_dateKey: { userId: me.id, questId: def.id, dateKey: dk } },
      create: { userId: me.id, questId: def.id, dateKey: dk, goal: def.goal, reward: def.reward },
      update: {},
    });
    return { ...row, metric: def.metric };
  }));
  return NextResponse.json({ dateKey: dk, quests: rows });
}

const claimSchema = z.object({ questId: z.string().min(2).max(30) });

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`quest:${me.id}`, 12, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = claimSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  if (!QUEST_POOL.find((q) => q.id === body.data.questId)) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

  const dk = dateKeyTehran();
  const q = await db.userQuest.findUnique({
    where: { userId_questId_dateKey: { userId: me.id, questId: body.data.questId, dateKey: dk } },
  });
  if (!q) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (q.claimed) return NextResponse.json({ error: 'CLAIMED' }, { status: 409 });
  if (q.progress < q.goal) return NextResponse.json({ error: 'NOT_DONE' }, { status: 400 });

  const [updated, user2] = await Promise.all([
    db.userQuest.update({ where: { id: q.id }, data: { claimed: true } }),
    db.user.update({ where: { id: me.id }, data: { coins: { increment: q.reward } } }),
  ]);
  await db.analyticsEvent.create({ data: { userId: me.id, type: 'quest_claim', payload: JSON.stringify({ questId: q.questId, reward: q.reward }) } });

  return NextResponse.json({ ok: true, quest: updated, coins: user2.coins, reward: q.reward });
}
