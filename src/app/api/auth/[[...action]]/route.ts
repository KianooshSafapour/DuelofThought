import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword, createSession, destroySession, currentUser, toSafeUser, isBanned } from '@/lib/auth';
import { rateLimit, rateLimitInfo, clientIp } from '@/lib/ratelimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[\p{L}\p{N}_]{3,16}$/u;

const registerSchema = z.object({
  username: z.string().min(3).max(16),
  password: z.string().min(6).max(72),
  locale: z.enum(['fa', 'en', 'ar', 'tr']).optional(),
});

async function sessionPayload(userId: string) {
  const [user, purchases] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.purchase.findMany({ where: { userId }, select: { itemId: true } }),
  ]);
  if (!user) return null;
  return { user: toSafeUser(user), owned: purchases.map((p) => p.itemId) };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop();
  const ip = clientIp(req);

  try {
    if (action === 'register') {
      if (!rateLimit(`reg:${ip}`, 5, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });
      const body = registerSchema.safeParse(await req.json());
      if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
      const { username, password, locale } = body.data;
      if (!USERNAME_RE.test(username)) return NextResponse.json({ error: 'INVALID_USERNAME' }, { status: 400 });
      const exists = await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } });
      if (exists) return NextResponse.json({ error: 'TAKEN' }, { status: 409 });
      const user = await db.user.create({
        data: {
          username, usernameLower: username.toLowerCase(),
          passwordHash: hashPassword(password),
          locale: locale ?? 'fa',
        },
      });
      for (const code of ['piece_terracotta', 'board_classic', 'bg_royal_velvet', 'fx_confetti', 'avatar_seedling', 'avatar_owl', 'avatar_fennec', 'emote_classic', 'celeb_confetti']) {
        await db.purchase.create({ data: { userId: user.id, itemId: code, price: 0 } }).catch(() => undefined);
      }
      await db.analyticsEvent.create({ data: { userId: user.id, type: 'register', payload: '{}' } });
      await createSession(user.id);
      return NextResponse.json(await sessionPayload(user.id));
    }

    if (action === 'login') {
      const rl = rateLimitInfo(`login:${ip}`, 12, 600_000);
      if (!rl.ok) {
        const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
        return NextResponse.json(
          { error: 'RATE', retryAfter },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
      const schema = z.object({ username: z.string().min(1).max(32), password: z.string().min(1).max(72) });
      const body = schema.safeParse(await req.json());
      if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
      const user = await db.user.findUnique({ where: { usernameLower: body.data.username.toLowerCase() } });
      if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
        return NextResponse.json({ error: 'BAD_CREDENTIALS', remaining: rl.remaining }, { status: 401 });
      }
      if (isBanned(user)) {
        return NextResponse.json({
          error: 'BANNED',
          reason: user.banReason ?? '',
          until: user.bannedUntil ? user.bannedUntil.toISOString() : 'permanent',
        }, { status: 403 });
      }
      await createSession(user.id);
      await db.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } });
      return NextResponse.json(await sessionPayload(user.id));
    }

    /** Hidden staff gate — admin-only server-side: no session is ever handed to
     *  a non-admin, every attempt is audited, and it has its OWN rate bucket so
     *  regular traffic can never lock the operator out. */
    if (action === 'staff-login') {
      const rl = rateLimitInfo(`staff:${ip}`, 8, 300_000);
      if (!rl.ok) {
        const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
        await db.auditLog.create({
          data: { action: 'staff_login_rate', targetId: ip, details: `retry in ${retryAfter}s` },
        }).catch(() => undefined);
        return NextResponse.json(
          { error: 'RATE', retryAfter },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
      const schema = z.object({ username: z.string().min(1).max(32), password: z.string().min(1).max(72) });
      const body = schema.safeParse(await req.json());
      if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
      const user = await db.user.findUnique({ where: { usernameLower: body.data.username.toLowerCase() } });
      const ok = !!user && verifyPassword(body.data.password, user.passwordHash);
      await db.auditLog.create({
        data: {
          actorId: ok ? user.id : null,
          action: ok ? 'staff_login_ok' : 'staff_login_fail',
          targetId: user ? user.id : body.data.username.slice(0, 32),
          details: ok ? 'gate: ok' : 'gate: rejected',
        },
      }).catch(() => undefined);
      if (!ok) return NextResponse.json({ error: 'BAD_CREDENTIALS', remaining: rl.remaining }, { status: 401 });
      if (user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'NOT_STAFF' }, { status: 403 });
      }
      if (isBanned(user)) {
        return NextResponse.json({ error: 'BANNED', reason: user.banReason ?? '' }, { status: 403 });
      }
      await createSession(user.id);
      await db.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } });
      return NextResponse.json(await sessionPayload(user.id));
    }

    if (action === 'guest') {
      if (!rateLimit(`guest:${ip}`, 6, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });
      const existing = await currentUser();
      if (existing?.isGuest) return NextResponse.json(await sessionPayload(existing.id));
      for (let i = 0; i < 5; i++) {
        const n = 1000 + Math.floor(Math.random() * 9000);
        const username = `Guest${n}`;
        const dupe = await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } });
        if (dupe) continue;
        const { randomBytes } = await import('crypto');
        const user = await db.user.create({
          data: {
            username, usernameLower: username.toLowerCase(),
            passwordHash: hashPassword(randomBytes(24).toString('hex')),
            isGuest: true, coins: 150,
          },
        });
        for (const code of ['piece_terracotta', 'board_classic', 'bg_royal_velvet', 'fx_confetti', 'avatar_seedling', 'avatar_owl', 'avatar_fennec', 'emote_classic', 'celeb_confetti']) {
          await db.purchase.create({ data: { userId: user.id, itemId: code, price: 0 } }).catch(() => undefined);
        }
        await createSession(user.id);
        return NextResponse.json(await sessionPayload(user.id));
      }
      return NextResponse.json({ error: 'TRY_AGAIN' }, { status: 500 });
    }

    if (action === 'logout') {
      const me = await currentUser();
      await destroySession();
      if (me?.role === 'ADMIN') {
        await db.auditLog.create({
          data: { actorId: me.id, action: 'staff_logout', targetId: me.id, details: 'gate: sign-out' },
        }).catch(() => undefined);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (e) {
    console.error('auth error', e);
    return NextResponse.json({ error: 'SERVER' }, { status: 500 });
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null });
  if (isBanned(user)) {
    return NextResponse.json({
      user: null, banned: true, reason: user.banReason ?? '',
      until: user.bannedUntil ? user.bannedUntil.toISOString() : 'permanent',
    });
  }
  return NextResponse.json(await sessionPayload(user.id));
}
