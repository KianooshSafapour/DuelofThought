/**
 * Admin API for friend-chat supervision (T9-c) — READ-ONLY.
 * Same RBAC as /api/admin/gift (role === 'ADMIN', not banned).
 * GET ?flagged=1|0&user=<username>&limit=50 → recent rows, usernames joined
 * GET ?thread=<userA>|<userB>             → that pair's full conversation
 * (reads need no audit; no destructive action exists in v1 by design)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(req.url);
  const thread = url.searchParams.get('thread');

  /* ---- pair conversation: ?thread=userA|userB ---- */
  if (thread) {
    const [aName, bName] = thread.split('|').map((s) => s.trim()).filter(Boolean);
    if (!aName || !bName) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const users = await db.user.findMany({
      where: { usernameLower: { in: [aName.toLowerCase(), bName.toLowerCase()] } },
      select: { id: true, username: true },
    });
    if (users.length < 2) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const [a, b] = users;
    const rows = await db.friendChatMessage.findMany({
      where: {
        OR: [
          { fromId: a.id, toId: b.id },
          { fromId: b.id, toId: a.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { from: { select: { username: true } }, to: { select: { username: true } } },
    });
    rows.reverse(); // ascending for reading
    return NextResponse.json({
      pair: [a.username, b.username],
      messages: rows.map((m) => ({
        id: m.id, from: m.from.username, to: m.to.username, body: m.body,
        masked: m.masked, flagged: m.flagged,
        flaggedWords: m.flaggedWords ? m.flaggedWords.split(',').filter(Boolean) : [],
        severity: m.severity,
        readAt: m.readAt ? m.readAt.toISOString() : null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  /* ---- recent feed: ?flagged=1|0&user=<username>&limit=50 ---- */
  const flagged = url.searchParams.get('flagged') === '1';
  const user = url.searchParams.get('user')?.trim() ?? '';
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));

  const rows = await db.friendChatMessage.findMany({
    where: {
      ...(flagged ? { flagged: true } : {}),
      ...(user
        ? { OR: [{ from: { usernameLower: user.toLowerCase() } }, { to: { usernameLower: user.toLowerCase() } }] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { from: { select: { username: true } }, to: { select: { username: true } } },
  });

  return NextResponse.json({
    messages: rows.map((m) => ({
      id: m.id, from: m.from.username, to: m.to.username, body: m.body,
      masked: m.masked, flagged: m.flagged,
      flaggedWords: m.flaggedWords ? m.flaggedWords.split(',').filter(Boolean) : [],
      severity: m.severity,
      readAt: m.readAt ? m.readAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
