import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Weekly Race — Saturday-anchored (Iranian week, Tehran time) competition.
 * Points: ONLINE win = 3, PVE HARD win = 2, other PVE win = 1 (locals excluded).
 * Prizes are claimable AFTER the week ends: 1st 500🪙 · 2nd 300🪙 · 3rd 150🪙.
 */

const PRIZES = [500, 300, 150];
const TEHRAN_OFFSET_MS = 3.5 * 3600_000;

/** YYYY-MM-DD (Tehran) of the Saturday that starts the week containing `now`. */
function saturdayKeyTehran(now = new Date()): string {
  const t = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  const day = t.getUTCDay(); // 0=Sun … 6=Sat
  const sinceSat = (day + 1) % 7; // Sat→0, Sun→1 … Fri→6
  const sat = new Date(t.getTime() - sinceSat * 86_400_000);
  return `${sat.getUTCFullYear()}-${String(sat.getUTCMonth() + 1).padStart(2, '0')}-${String(sat.getUTCDate()).padStart(2, '0')}`;
}

function keyToUtcRange(key: string): { start: Date; end: Date } {
  const [y, m, d] = key.split('-').map(Number);
  // Tehran midnight of `key` expressed as a UTC instant
  const startMs = Date.UTC(y, m - 1, d) - TEHRAN_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + 7 * 86_400_000) };
}

function prevWeekKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return saturdayKeyTehran(new Date(Date.UTC(y, m - 1, d) - 7 * 86_400_000));
}

type WinRow = { p1Id: string | null; p2Id: string | null; mode: string; aiLevel: string | null; winner: string };

function pointsFor(r: WinRow, side: 1 | 2): number {
  const won = (side === 1 && r.winner === 'P1') || (side === 2 && r.winner === 'P2');
  if (!won) return 0;
  if (r.mode === 'ONLINE') return 3;
  if (r.mode === 'PVE') return r.aiLevel === 'HARD' ? 2 : 1;
  return 0;
}

async function raceStandings(start: Date, end: Date) {
  const rows = await db.gameResult.findMany({
    where: { createdAt: { gte: start, lt: end }, winner: { not: 'DRAW' }, mode: { in: ['ONLINE', 'PVE'] } },
    select: { p1Id: true, p2Id: true, mode: true, aiLevel: true, winner: true },
  });
  const acc = new Map<string, { points: number; wins: number }>();
  const bump = (id: string | null, pts: number, win: boolean) => {
    if (!id) return;
    const cur = acc.get(id) ?? { points: 0, wins: 0 };
    cur.points += pts;
    if (win) cur.wins++;
    acc.set(id, cur);
  };
  for (const r of rows) {
    bump(r.p1Id, pointsFor(r, 1), r.winner === 'P1');
    bump(r.p2Id, pointsFor(r, 2), r.winner === 'P2');
  }
  const ids = [...acc.keys()];
  if (ids.length === 0) return [] as { userId: string; username: string; avatarItem: string; titleItem: string | null; isGuest: boolean; points: number; wins: number }[];
  const users = await db.user.findMany({
    where: { id: { in: ids }, banned: false, role: { not: 'ADMIN' } },
    select: { id: true, username: true, avatarItem: true, titleItem: true, isGuest: true },
  });
  const stand = users
    .map((u) => ({ userId: u.id, username: u.username, avatarItem: u.avatarItem, titleItem: u.titleItem, isGuest: u.isGuest, points: acc.get(u.id)!.points, wins: acc.get(u.id)!.wins }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.username.localeCompare(b.username));
  return stand;
}

export async function GET() {
  const me = await currentUser();

  const thisKey = saturdayKeyTehran();
  const { start, end } = keyToUtcRange(thisKey);
  const lastKey = prevWeekKey(thisKey);
  const lastRange = keyToUtcRange(lastKey);

  const [stand, lastStand] = await Promise.all([
    raceStandings(start, end),
    raceStandings(lastRange.start, lastRange.end),
  ]);

  let my: { points: number; wins: number; rank: number | null } | null = null;
  let myClaim: { rank: number; reward: number } | null = null;
  let claimed = false;
  if (me) {
    const idx = stand.findIndex((s) => s.userId === me.id);
    my = { points: idx >= 0 ? stand[idx].points : 0, wins: idx >= 0 ? stand[idx].wins : 0, rank: idx >= 0 ? idx + 1 : null };
    const lastIdx = lastStand.findIndex((s) => s.userId === me.id);
    if (lastIdx >= 0 && lastIdx < PRIZES.length) {
      myClaim = { rank: lastIdx + 1, reward: PRIZES[lastIdx] };
      const existing = await db.weeklyClaim.findUnique({
        where: { userId_weekKey: { userId: me.id, weekKey: lastKey } },
      });
      claimed = !!existing;
    }
  }

  return NextResponse.json({
    weekKey: thisKey,
    weekEnd: end.toISOString(),
    serverNow: new Date().toISOString(),
    prizes: PRIZES,
    top: stand.slice(0, 10),
    my,
    lastWeek: { weekKey: lastKey, top: lastStand.slice(0, 3), myClaim, claimed },
  });
}

export async function POST() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`weekclaim:${me.id}`, 6, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const thisKey = saturdayKeyTehran();
  const lastKey = prevWeekKey(thisKey);
  const lastRange = keyToUtcRange(lastKey);
  const stand = await raceStandings(lastRange.start, lastRange.end);
  const idx = stand.findIndex((s) => s.userId === me.id);
  if (idx < 0 || idx >= PRIZES.length) {
    return NextResponse.json({ error: 'NOT_ELIGIBLE' }, { status: 409 });
  }
  const rank = idx + 1;
  const reward = PRIZES[idx];

  try {
    await db.weeklyClaim.create({ data: { userId: me.id, weekKey: lastKey, rank, reward } });
  } catch {
    return NextResponse.json({ error: 'CLAIMED' }, { status: 409 });
  }

  const updated = await db.user.update({ where: { id: me.id }, data: { coins: { increment: reward } } });
  await db.analyticsEvent.create({
    data: { userId: me.id, type: 'weekly_prize_claim', payload: JSON.stringify({ weekKey: lastKey, rank, reward }) },
  });

  return NextResponse.json({ ok: true, reward, rank, coins: updated.coins });
}
