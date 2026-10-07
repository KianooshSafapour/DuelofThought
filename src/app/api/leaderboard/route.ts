import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PRESENCE_URL = 'http://127.0.0.1:3003/presence';

/** online+duel status from the referee service (fails soft → empty sets) */
async function presenceSets(): Promise<{ online: Set<string>; dueling: Set<string> }> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(PRESENCE_URL, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { online: new Set(), dueling: new Set() };
    const data = (await res.json()) as { online?: string[]; dueling?: string[] };
    return {
      online: new Set(Array.isArray(data.online) ? data.online : []),
      dueling: new Set(Array.isArray(data.dueling) ? data.dueling : []),
    };
  } catch {
    return { online: new Set(), dueling: new Set() };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') ?? 'rating';
  const orderBy =
    sort === 'wins' ? [{ wins: 'desc' as const }, { rating: 'desc' as const }] :
    sort === 'level' ? [{ level: 'desc' as const }, { xp: 'desc' as const }] :
    [{ rating: 'desc' as const }, { wins: 'desc' as const }];

  const me = await currentUser();

  const [rows, total, pres] = await Promise.all([
    db.user.findMany({
      where: { banned: false, role: { not: 'ADMIN' } },
      orderBy,
      take: 50,
      select: {
        id: true, username: true, level: true, rating: true, wins: true, losses: true,
        draws: true, gamesPlayed: true, bestStreak: true, avatarItem: true, titleItem: true,
        pieceSkin: true, isGuest: true,
      },
    }),
    db.user.count({ where: { banned: false, role: { not: 'ADMIN' } } }),
    presenceSets(),
  ]);

  /* social layer (only for logged-in viewers): which top-50 players are my
     friends / online / mid-duel — powers inline challenge buttons */
  let friendIds = new Set<string>();
  if (me) {
    const links = await db.friendship.findMany({
      where: { userId: me.id },
      select: { friendId: true },
      take: 100,
    });
    friendIds = new Set(links.map((l) => l.friendId));
  }

  return NextResponse.json({
    total,
    players: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      isFriend: friendIds.has(r.id),
      online: pres.online.has(r.id),
      dueling: pres.dueling.has(r.id),
    })),
  });
}
