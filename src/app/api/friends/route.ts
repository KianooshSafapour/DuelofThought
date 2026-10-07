/**
 * Friends API — list/add/accept/decline/cancel/remove.
 * Presence is resolved from the duel-socket service (internal fetch).
 * Guests cannot use the friends system (no persistent identity across devices).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const MAX_FRIENDS = 50;
const SOCKET_URL = 'http://127.0.0.1:3003/presence';

interface PresenceRes { ok: boolean; online: string[]; dueling?: string[]; queuing?: string[] }

async function onlineSet(): Promise<Set<string>> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(SOCKET_URL, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) { console.error('[friends] presence HTTP', res.status); return new Set(); }
    const data = (await res.json()) as PresenceRes;
    return new Set(Array.isArray(data.online) ? data.online : []);
  } catch (e) {
    console.error('[friends] presence fetch failed', e);
    return new Set();
  }
}

/** live duel/queue status straight from the referee service (fails soft → empty) */
async function duelSets(): Promise<{ dueling: Set<string>; queuing: Set<string> }> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(SOCKET_URL, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { dueling: new Set(), queuing: new Set() };
    const data = (await res.json()) as PresenceRes;
    return {
      dueling: new Set(Array.isArray(data.dueling) ? data.dueling : []),
      queuing: new Set(Array.isArray(data.queuing) ? data.queuing : []),
    };
  } catch {
    return { dueling: new Set(), queuing: new Set() };
  }
}

export async function GET() {
  const me = await currentUser();
  if (!me || isBanned(me)) return NextResponse.json({ error: 'AUTH' }, { status: 401 });

  const duelP = duelSets();
  const [friendRows, incoming, outgoing, online, dueling, queuing] = await Promise.all([
    db.friendship.findMany({
      where: { userId: me.id },
      include: { friend: { select: { id: true, username: true, avatarItem: true, titleItem: true, level: true, rating: true, wins: true, gamesPlayed: true, isGuest: true, banned: true, bannedUntil: true, lastSeen: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_FRIENDS,
    }),
    db.friendRequest.findMany({
      where: { toId: me.id },
      include: { from: { select: { id: true, username: true, avatarItem: true, level: true, rating: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    db.friendRequest.findMany({
      where: { fromId: me.id },
      include: { to: { select: { id: true, username: true, avatarItem: true, level: true, rating: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    onlineSet(),
    duelP.then((s) => s.dueling),
    duelP.then((s) => s.queuing),
  ]);

  return NextResponse.json({
    friends: friendRows
      .filter((r) => !r.friend.isGuest)
      .map((r) => ({
        id: r.friend.id,
        username: r.friend.username,
        avatarItem: r.friend.avatarItem,
        titleItem: r.friend.titleItem,
        level: r.friend.level,
        rating: r.friend.rating,
        wins: r.friend.wins,
        gamesPlayed: r.friend.gamesPlayed,
        online: online.has(r.friend.id),
        dueling: dueling.has(r.friend.id),
        queuing: queuing.has(r.friend.id),
        suspended: isBanned(r.friend),
        lastSeen: r.friend.lastSeen.toISOString(),
      })),
    incoming: incoming.map((r) => ({ id: r.id, from: r.from })),
    outgoing: outgoing.map((r) => ({ id: r.id, to: r.to })),
  });
}

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me || isBanned(me)) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (me.isGuest) return NextResponse.json({ error: 'GUEST' }, { status: 403 });

  let body: { action?: string; username?: string; id?: string; friendId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'BAD' }, { status: 400 }); }
  const action = String(body.action ?? '');

  if (action === 'add') {
    if (!rateLimit(`fr:add:${me.id}`, 10, 10 * 60_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });
    const username = String(body.username ?? '').trim();
    if (username.length < 3 || username.length > 16) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const target = await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } });
    if (!target || target.isGuest) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (target.id === me.id) return NextResponse.json({ error: 'SELF' }, { status: 400 });
    if (isBanned(target)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    const already = await db.friendship.findFirst({ where: { userId: me.id, friendId: target.id } });
    if (already) return NextResponse.json({ error: 'ALREADY' }, { status: 409 });

    // they already requested me → accept instantly (mutual-add UX)
    const theirs = await db.friendRequest.findFirst({ where: { fromId: target.id, toId: me.id } });
    if (theirs) {
      await befriend(me.id, target.id);
      await db.friendRequest.delete({ where: { id: theirs.id } }).catch(() => undefined);
      return NextResponse.json({ ok: true, autoAccepted: true });
    }
    const mine = await db.friendRequest.findFirst({ where: { fromId: me.id, toId: target.id } });
    if (mine) return NextResponse.json({ error: 'PENDING' }, { status: 409 });

    const count = await db.friendship.count({ where: { userId: me.id } });
    if (count >= MAX_FRIENDS) return NextResponse.json({ error: 'LIMIT' }, { status: 409 });

    await db.friendRequest.create({ data: { fromId: me.id, toId: target.id } });
    return NextResponse.json({ ok: true });
  }

  if (action === 'accept' || action === 'decline') {
    const id = String(body.id ?? '');
    const request = await db.friendRequest.findUnique({ where: { id } });
    if (!request || request.toId !== me.id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await db.friendRequest.delete({ where: { id } });
    if (action === 'accept') {
      const count = await db.friendship.count({ where: { userId: me.id } });
      if (count >= MAX_FRIENDS) return NextResponse.json({ error: 'LIMIT' }, { status: 409 });
      await befriend(me.id, request.fromId);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'cancel') {
    const id = String(body.id ?? '');
    const request = await db.friendRequest.findUnique({ where: { id } });
    if (!request || request.fromId !== me.id) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await db.friendRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  if (action === 'remove') {
    const friendId = String(body.friendId ?? '');
    const n = await db.friendship.deleteMany({ where: { userId: me.id, friendId } });
    await db.friendship.deleteMany({ where: { userId: friendId, friendId: me.id } });
    if (n.count === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'BAD' }, { status: 400 });
}

/** Create the bidirectional friendship rows (idempotent). */
async function befriend(a: string, b: string) {
  await db.friendship.upsert({
    where: { userId_friendId: { userId: a, friendId: b } },
    update: {},
    create: { userId: a, friendId: b },
  });
  await db.friendship.upsert({
    where: { userId_friendId: { userId: b, friendId: a } },
    update: {},
    create: { userId: b, friendId: a },
  });
}
