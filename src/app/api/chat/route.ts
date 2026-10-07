/**
 * Friend-chat API (T9-c) — supervised direct messages between friends.
 *
 * Moderation stack: every outbound message runs through filterText() —
 *   severity 0 → store as-is · 1 → store masked · 2 → store masked + flagged
 *   3 → NOT stored, 400 CHAT_BLOCKED + analytics 'chat_blocked' event
 * (auto-punish escalation for severity 3 lives in the in-game socket service
 * and is intentionally out of scope here.)
 *
 * Read receipts: any GET of a conversation batch-marks unread messages
 * addressed to me as read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { filterText } from '@/lib/moderation';

export const dynamic = 'force-dynamic';

const MAX_BODY = 500;
const PAGE = 60;

type MsgRow = {
  id: string; fromId: string; toId: string; body: string; masked: boolean;
  flagged: boolean; flaggedWords: string; severity: number;
  readAt: Date | null; createdAt: Date;
  from?: { username: string } | null; to?: { username: string } | null;
};

function dto(m: MsgRow) {
  return {
    id: m.id,
    from: m.from?.username ?? m.fromId,
    to: m.to?.username ?? m.toId,
    body: m.body, // stored text — already masked server-side when needed
    masked: m.masked,
    flagged: m.flagged,
    flaggedWords: m.flaggedWords ? m.flaggedWords.split(',').filter(Boolean) : [],
    severity: m.severity,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

function authGuard(me: Awaited<ReturnType<typeof currentUser>>): NextResponse | null {
  if (!me || isBanned(me)) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (me.isGuest) return NextResponse.json({ error: 'GUEST' }, { status: 403 });
  return null;
}

/** friendship = rows exist in BOTH directions (written by the friends API) */
async function areFriends(a: string, b: string): Promise<boolean> {
  const [fwd, rev] = await Promise.all([
    db.friendship.findFirst({ where: { userId: a, friendId: b }, select: { id: true } }),
    db.friendship.findFirst({ where: { userId: b, friendId: a }, select: { id: true } }),
  ]);
  return Boolean(fwd && rev);
}

async function resolveTarget(username: string) {
  const name = username.trim();
  if (!name || name.length > 16) return null;
  const u = await db.user.findUnique({
    where: { usernameLower: name.toLowerCase() },
    select: { id: true, username: true, avatarItem: true, level: true, isGuest: true, banned: true, bannedUntil: true },
  });
  if (!u || u.isGuest || isBanned(u)) return null;
  return u;
}

/* ------------------------------- GET ------------------------------- */

export async function GET(req: NextRequest) {
  const me = await currentUser();
  const denied = authGuard(me);
  if (denied) return denied;
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });

  const url = new URL(req.url);
  const withName = url.searchParams.get('with');

  /* ---- thread list (no ?with=): friends + last message + unread count ---- */
  if (!withName) {
    const [friendRows, recent] = await Promise.all([
      db.friendship.findMany({
        where: { userId: me.id },
        include: { friend: { select: { id: true, username: true, avatarItem: true, level: true, isGuest: true, banned: true, bannedUntil: true } } },
        take: 60,
      }),
      // small demo table: pull recent rows and group in JS
      db.friendChatMessage.findMany({
        where: { OR: [{ fromId: me.id }, { toId: me.id }] },
        orderBy: { createdAt: 'desc' },
        take: 400,
      }),
    ]);

    const byPartner = new Map<string, { last: MsgRow; unread: number }>();
    for (const m of recent) {
      const partnerId = m.fromId === me.id ? m.toId : m.fromId;
      const entry = byPartner.get(partnerId);
      if (!entry) byPartner.set(partnerId, { last: m, unread: 0 });
      if (m.toId === me.id && !m.readAt) byPartner.get(partnerId)!.unread++;
    }

    const threads = friendRows
      .filter((r) => !r.friend.isGuest && !isBanned(r.friend))
      .map((r) => {
        const t = byPartner.get(r.friend.id);
        return {
          friend: {
            id: r.friend.id,
            username: r.friend.username,
            avatarItem: r.friend.avatarItem,
            level: r.friend.level,
          },
          last: t
            ? { fromId: t.last.fromId === me.id ? 'me' : 'them', body: t.last.body, masked: t.last.masked, createdAt: t.last.createdAt.toISOString() }
            : null,
          unread: t?.unread ?? 0,
        };
      });

    return NextResponse.json({ threads });
  }

  /* ---- one conversation (?with=<username>[&after=<iso>]) ---- */
  const target = await resolveTarget(withName);
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!(await areFriends(me.id, target.id))) return NextResponse.json({ error: 'NOT_FRIEND' }, { status: 403 });

  // read receipts: batch-mark messages addressed to me as read BEFORE fetching
  const marked = await db.friendChatMessage.updateMany({
    where: { toId: me.id, fromId: target.id, readAt: null },
    data: { readAt: new Date() },
  });

  const pair = [{ fromId: me.id, toId: target.id }, { fromId: target.id, toId: me.id }];
  const afterRaw = url.searchParams.get('after');
  const afterDate = afterRaw ? new Date(afterRaw) : null;
  const useAfter = afterDate && !Number.isNaN(afterDate.getTime());

  let rows: MsgRow[] = await db.friendChatMessage.findMany({
    where: useAfter ? { AND: [{ OR: pair }, { createdAt: { gt: afterDate as Date } }] } : { OR: pair },
    orderBy: { createdAt: useAfter ? 'asc' : 'desc' },
    take: PAGE,
    include: { from: { select: { username: true } }, to: { select: { username: true } } },
  });
  if (!useAfter) rows = rows.reverse(); // newest page → ascending order

  return NextResponse.json({
    friend: { username: target.username, avatarItem: target.avatarItem, level: target.level },
    markedRead: marked.count,
    messages: rows.map(dto),
  });
}

/* ------------------------------- POST ------------------------------ */

export async function POST(req: NextRequest) {
  const me = await currentUser();
  const denied = authGuard(me);
  if (denied) return denied;
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });

  let payload: { to?: string; body?: string };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'BAD' }, { status: 400 }); }
  const text = String(payload.body ?? '').trim();
  if (!payload.to || text.length < 1 || text.length > MAX_BODY) {
    return NextResponse.json({ error: 'BAD' }, { status: 400 });
  }

  if (!rateLimit(`chat:${me.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'RATE' }, { status: 429 });
  }

  const target = await resolveTarget(String(payload.to));
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!(await areFriends(me.id, target.id))) return NextResponse.json({ error: 'NOT_FRIEND' }, { status: 403 });

  const filter = await filterText(text);

  // severity 3 → hard block: store nothing, log for the trust & safety pipeline
  if (filter.maxSeverity >= 3) {
    await db.analyticsEvent.create({
      data: {
        userId: me.id,
        type: 'chat_blocked',
        payload: JSON.stringify({ to: target.username, words: filter.words }),
      },
    }).catch(() => undefined);
    return NextResponse.json({ error: 'CHAT_BLOCKED' }, { status: 400 });
  }

  const msg: MsgRow = await db.friendChatMessage.create({
    data: {
      fromId: me.id,
      toId: target.id,
      body: filter.masked, // masked text is what gets stored & shown
      masked: filter.maxSeverity >= 1,
      flagged: filter.maxSeverity >= 2,
      flaggedWords: filter.words.join(',').slice(0, 200),
      severity: filter.maxSeverity,
    },
    include: { from: { select: { username: true } }, to: { select: { username: true } } },
  });

  return NextResponse.json({ ok: true, message: dto(msg) });
}

/* ------------------------------- PATCH ----------------------------- */

/** Minimal housekeeping: { to: username, markRead: true } → clear my unread. */
export async function PATCH(req: NextRequest) {
  const me = await currentUser();
  const denied = authGuard(me);
  if (denied) return denied;
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });

  let payload: { to?: string; markRead?: boolean };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'BAD' }, { status: 400 }); }
  if (!payload.to || payload.markRead !== true) return NextResponse.json({ error: 'BAD' }, { status: 400 });

  const target = await resolveTarget(String(payload.to));
  if (!target) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const n = await db.friendChatMessage.updateMany({
    where: { toId: me.id, fromId: target.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: n.count });
}
