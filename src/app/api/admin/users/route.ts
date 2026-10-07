import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 32);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);

  /* single-user deep profile (admin drawer) */
  const userId = (url.searchParams.get('userId') ?? '').trim();
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, role: true, isGuest: true, banned: true, banReason: true,
        bannedUntil: true, banCount: true, coins: true, xp: true, level: true, rating: true,
        wins: true, losses: true, draws: true, gamesPlayed: true, streak: true, bestStreak: true,
        bio: true, locale: true, pieceSkin: true, boardSkin: true, background: true,
        effectSkin: true, avatarItem: true, titleItem: true, showcase: true, soundOn: true,
        checkinStreak: true, createdAt: true, lastSeen: true,
      },
    });
    if (!user) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const [matches, purchases, reportsAgainst, reportsBy] = await Promise.all([
      db.gameResult.findMany({
        where: { OR: [{ p1Id: userId }, { p2Id: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, mode: true, aiLevel: true, winner: true, endReason: true, p1Id: true, p2Id: true, p1Name: true, p2Name: true, p1RatingDelta: true, p2RatingDelta: true, moves: true, createdAt: true },
      }),
      db.purchase.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, itemId: true, price: true, createdAt: true },
      }),
      db.report.count({ where: { targetName: user.username } }),
      db.report.count({ where: { reporterId: userId } }),
    ]);
    return NextResponse.json({ user, matches, purchases, reportsAgainst, reportsBy });
  }

  const where = q ? { OR: [{ username: { contains: q } }, { usernameLower: { contains: q.toLowerCase() } }] } : {};
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: page * 25,
      take: 25,
      select: {
        id: true, username: true, role: true, isGuest: true, banned: true, banReason: true,
        bannedUntil: true, coins: true, level: true, rating: true, wins: true, losses: true,
        draws: true, gamesPlayed: true, createdAt: true, lastSeen: true, locale: true, banCount: true,
      },
    }),
    db.user.count({ where }),
  ]);
  return NextResponse.json({ users, total, page });
}

const actionSchema = z.object({
  userId: z.string().min(5).max(40),
  action: z.enum(['ban', 'unban', 'grant_coins', 'promote', 'demote']),
  days: z.number().int().min(0).max(3650).optional(),
  permanent: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  amount: z.number().int().min(-100000).max(100000).optional(),
});

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  if (!rateLimit(`adminact:${admin.id}`, 60, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = actionSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const { userId, action } = body.data;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (target.role === 'ADMIN' && action !== 'grant_coins' && target.id !== admin.id) {
    return NextResponse.json({ error: 'ADMIN_TARGET' }, { status: 403 });
  }

  let note = '';
  switch (action) {
    case 'ban': {
      const until = body.data.permanent || body.data.days === 0 ? null : new Date(Date.now() + body.data.days! * 86_400_000);
      await db.user.update({
        where: { id: userId },
        data: { banned: true, banReason: body.data.reason ?? 'ورود به قوانین', bannedUntil: until, banCount: { increment: 1 } },
      });
      // kill sessions so ban is immediate
      await db.session.deleteMany({ where: { userId } });
      note = `banned until ${until?.toISOString() ?? 'permanent'}`;
      break;
    }
    case 'unban':
      await db.user.update({ where: { id: userId }, data: { banned: false, banReason: null, bannedUntil: null } });
      note = 'unbanned';
      break;
    case 'grant_coins': {
      const amount = body.data.amount ?? 0;
      await db.user.update({ where: { id: userId }, data: { coins: { increment: amount } } });
      note = `coins ${amount > 0 ? '+' : ''}${amount}`;
      break;
    }
    case 'promote':
      await db.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
      note = 'promoted to admin';
      break;
    case 'demote':
      if (target.id === admin.id) return NextResponse.json({ error: 'SELF' }, { status: 400 });
      await db.user.update({ where: { id: userId }, data: { role: 'PLAYER' } });
      note = 'demoted to player';
      break;
  }

  await db.auditLog.create({
    data: { actorId: admin.id, action: `user_${action}`, targetId: userId, details: note },
  });
  return NextResponse.json({ ok: true, note });
}
