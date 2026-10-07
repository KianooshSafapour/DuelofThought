import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/admin/monitor — live ops: presence, recent events, economy pulse */
export async function GET() {
  const admin = await currentUser();
  if (!admin || admin.role !== 'ADMIN' || isBanned(admin)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const now = new Date();
  const since = new Date(now.getTime() - 15 * 60_000);

  const [events, onlineNow, arcadeToday, boxOpensToday, purchasesToday, coinsMintedToday] = await Promise.all([
    db.analyticsEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { user: { select: { username: true } } },
    }),
    db.user.count({ where: { lastSeen: { gte: new Date(now.getTime() - 5 * 60_000) } } }),
    db.arcadeScore.count({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    db.boxGrant.count({ where: { openedAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    db.purchase.count({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) }, price: { gt: 0 } } }),
    db.analyticsEvent.count({ where: { type: { startsWith: 'game_' }, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);

  // live duel presence from the socket service (best-effort)
  let presence = { players: 0, live: 0 };
  try {
    const r = await fetch('http://127.0.0.1:3003/', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const j = (await r.json()) as { players?: number; live?: number };
      presence = { players: j.players ?? 0, live: j.live ?? 0 };
    }
  } catch { /* socket service down — fine */ }

  return NextResponse.json({
    presence,
    onlineNow,
    arcadeToday,
    boxOpensToday,
    purchasesToday,
    gameEventsToday: coinsMintedToday,
    events: events.map((e) => ({
      id: e.id, type: e.type, username: e.user?.username ?? null,
      payload: e.payload, createdAt: e.createdAt,
    })),
  });
}
