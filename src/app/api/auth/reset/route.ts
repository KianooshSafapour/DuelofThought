/**
 * POST /api/auth/reset — step 2 of SMS password recovery.
 * Body: { phone, code, newPassword }. Verifies the hashed 6-digit code,
 * throttles brute-force via per-code attempt counting, then swaps the
 * password and kills every live session of that user.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sha256, hashPassword } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const PHONE_RE = /^\+?\d{7,15}$/;
const MAX_ATTEMPTS = 5;

const schema = z.object({
  phone: z.string().max(24),
  code: z.string().max(8),
  newPassword: z.string().max(72),
});

/** Strip spaces/dashes/parens; keep a single leading +. */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (stripped.startsWith('+')) return '+' + stripped.slice(1).replace(/\+/g, '');
  return stripped;
}

export async function POST(req: Request) {
  // modest IP throttle on the verification endpoint itself
  if (!rateLimit(`reset:${clientIp(req)}`, 15, 600_000)) {
    return NextResponse.json({ error: 'RATE' }, { status: 429 });
  }

  try {
    const body = schema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const phone = normalizePhone(body.data.phone);
    if (!PHONE_RE.test(phone)) return NextResponse.json({ error: 'PHONE_BAD' }, { status: 400 });
    if (!/^\d{6}$/.test(body.data.code)) return NextResponse.json({ error: 'CODE_INVALID' }, { status: 400 });
    if (body.data.newPassword.length < 6) return NextResponse.json({ error: 'INVALID' }, { status: 400 });

    const user = await db.user.findFirst({ where: { phone } });
    if (!user) return NextResponse.json({ error: 'CODE_INVALID' }, { status: 400 });

    const row = await db.passwordResetCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return NextResponse.json({ error: 'CODE_INVALID' }, { status: 400 });
    if (row.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: 'CODE_EXPIRED' }, { status: 400 });
    if (row.attempts >= MAX_ATTEMPTS) return NextResponse.json({ error: 'CODE_INVALID' }, { status: 400 });

    if (row.codeHash !== sha256(body.data.code)) {
      await db.passwordResetCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      return NextResponse.json({ error: 'CODE_INVALID' }, { status: 400 });
    }

    // success: burn the code, swap the password, evict every session (a stolen
    // login cookie becomes useless the moment the owner reclaims the account)
    await db.$transaction([
      db.passwordResetCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      db.passwordResetCode.deleteMany({
        where: { userId: user.id, usedAt: null, id: { not: row.id } },
      }),
      db.session.deleteMany({ where: { userId: user.id } }),
      db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(body.data.newPassword) } }),
    ]);
    await db.analyticsEvent.create({
      data: { userId: user.id, type: 'password_reset', payload: '{}' },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('reset error', e);
    return NextResponse.json({ error: 'SERVER' }, { status: 500 });
  }
}
