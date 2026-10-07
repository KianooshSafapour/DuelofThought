import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { rollDrop, levelFromXp } from '@/lib/game/content';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Fortune chests: catalog + my inventory */
export async function GET() {
  const me = await currentUser();
  const [boxes, grants, drops] = await Promise.all([
    db.lootBoxDef.findMany({ where: { active: true }, orderBy: { price: 'asc' } }),
    me ? db.boxGrant.findMany({ where: { userId: me.id, openedAt: null }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    db.lootBoxDrop.findMany({ orderBy: { weight: 'desc' } }),
  ]);
  return NextResponse.json({
    boxes: boxes.map((b) => ({ ...b, drops: drops.filter((d) => d.boxCode === b.code) })),
    inventory: grants,
    me: me ? { coins: me.coins, level: me.level } : null,
  });
}

const buySchema = z.object({ action: z.literal('buy'), boxCode: z.string().min(3).max(30) });
const openSchema = z.object({ action: z.literal('open'), grantId: z.string().min(5).max(40) });

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`market:${me.id}`, 30, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const raw = await req.json().catch(() => null);
  const buyParsed = buySchema.safeParse(raw);
  const openParsed = buyParsed.success ? null : openSchema.safeParse(raw);
  if (!buyParsed.success && !(openParsed && openParsed.success)) {
    return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  }

  /* -------- BUY a chest -------- */
  if (buyParsed.success) {
    const body = buyParsed.data;
    const def = await db.lootBoxDef.findUnique({ where: { code: body.boxCode } });
    if (!def || !def.active) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (me.coins < def.price) return NextResponse.json({ error: 'COINS', need: def.price - me.coins }, { status: 402 });

    const [, user2] = await Promise.all([
      db.boxGrant.create({ data: { userId: me.id, boxCode: def.code, source: 'PURCHASE' } }),
      db.user.update({ where: { id: me.id }, data: { coins: { decrement: def.price } } }),
    ]);
    await db.analyticsEvent.create({ data: { userId: me.id, type: 'box_buy', payload: JSON.stringify({ box: def.code, price: def.price }) } });
    return NextResponse.json({ ok: true, coins: user2.coins });
  }

  /* -------- OPEN a chest (weighted roll, server-authoritative) -------- */
  if (!openParsed || !openParsed.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const openBody = openParsed.data;
  const grant = await db.boxGrant.findUnique({ where: { id: openBody.grantId } });
  if (!grant || grant.userId !== me.id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (grant.openedAt) return NextResponse.json({ error: 'ALREADY' }, { status: 409 });

  const def = await db.lootBoxDef.findUnique({ where: { code: grant.boxCode }, include: { drops: true } });
  if (!def) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const pool = def.drops.map((d) => ({ kind: d.kind as 'COINS' | 'XP' | 'ITEM', itemCode: d.itemCode ?? undefined, amount: d.amount, weight: d.weight }));
  const drop = rollDrop(pool);

  let coinsDelta = 0;
  let xpDelta = 0;
  let item: { code: string; dupe: boolean; refund: number; rarity: string } | null = null;

  if (drop.kind === 'COINS') coinsDelta = drop.amount;
  else if (drop.kind === 'XP') xpDelta = drop.amount;
  else if (drop.kind === 'ITEM' && drop.itemCode) {
    const storeItem = await db.storeItem.findUnique({ where: { code: drop.itemCode } });
    if (storeItem) {
      const already = await db.purchase.findUnique({ where: { userId_itemId: { userId: me.id, itemId: storeItem.code } } });
      if (already) {
        const refund = Math.max(50, Math.round(storeItem.price * 0.6));
        coinsDelta += refund;
        item = { code: storeItem.code, dupe: true, refund, rarity: storeItem.rarity };
      } else {
        await db.purchase.create({ data: { userId: me.id, itemId: storeItem.code, price: 0 } });
        await db.storeItem.update({ where: { code: storeItem.code }, data: { sales: { increment: 1 } } });
        item = { code: storeItem.code, dupe: false, refund: 0, rarity: storeItem.rarity };
      }
    }
  }

  const newXp = me.xp + xpDelta;
  const newLevel = levelFromXp(newXp).level;
  const [, user2] = await Promise.all([
    db.boxGrant.update({ where: { id: grant.id }, data: { openedAt: new Date() } }),
    db.user.update({ where: { id: me.id }, data: { coins: { increment: coinsDelta }, xp: newXp, level: newLevel } }),
    db.lootBoxDef.update({ where: { code: def.code }, data: { opens: { increment: 1 } } }),
    db.analyticsEvent.create({ data: { userId: me.id, type: 'box_open', payload: JSON.stringify({ box: def.code, kind: drop.kind, item: drop.itemCode ?? null, amount: drop.amount }) } }),
  ]);

  /* achievement progress (boxOpens) */
  const achUnlocked: { id: string; coins: number; rarity: string }[] = [];
  const boxOpens = await db.boxGrant.count({ where: { userId: me.id, openedAt: { not: null } } });
  const achDefs = [
    { id: 'box_1', goal: 1, coins: 50, rarity: 'COMMON' },
    { id: 'box_10', goal: 10, coins: 190, rarity: 'RARE' },
  ];
  for (const a of achDefs) {
    if (boxOpens >= a.goal) {
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
          coinsDelta += a.coins;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    drop: { kind: drop.kind, itemCode: drop.itemCode ?? null, amount: drop.amount },
    item,
    coinsDelta,
    xpDelta,
    levelUps: Math.max(0, newLevel - me.level),
    user: { coins: user2.coins, xp: user2.xp, level: user2.level },
    unlockedAchievements: achUnlocked,
  });
}
