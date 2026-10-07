/**
 * POST /api/auth/forgot — step 1 of SMS password recovery.
 * Body: { phone }. Always answers { ok: true } (plus devCode in sandbox mode)
 * so an attacker cannot enumerate which phones are registered — a code is only
 * actually created & sent when the phone belongs to a real, non-guest user.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sha256 } from '@/lib/auth';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { sendSms } from '@/lib/sms';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const PHONE_RE = /^\+?\d{7,15}$/;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LIVE_CODES = 3; // per user, unused & unexpired

const schema = z.object({ phone: z.string().min(5).max(24) });

/** Strip spaces/dashes/parens; keep a single leading +. */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (stripped.startsWith('+')) return '+' + stripped.slice(1).replace(/\+/g, '');
  return stripped;
}

export async function POST(req: Request) {
  try {
    const body = schema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'PHONE_BAD' }, { status: 400 });
    const phone = normalizePhone(body.data.phone);
    if (!PHONE_RE.test(phone)) return NextResponse.json({ error: 'PHONE_BAD' }, { status: 400 });

    // 3 requests per 10 minutes per IP+phone
    if (!rateLimit(`forgot:${clientIp(req)}:${phone}`, 3, 600_000)) {
      return NextResponse.json({ error: 'RATE' }, { status: 429 });
    }

    const user = await db.user.findFirst({ where: { phone } });
    if (!user || user.isGuest) {
      // anti-enumeration: identical response for unknown phones
      return NextResponse.json({ ok: true });
    }

    // cap concurrent live codes (blocks code-flooding / carrier spam)
    const live = await db.passwordResetCode.count({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (live >= MAX_LIVE_CODES) return NextResponse.json({ error: 'RATE' }, { status: 429 });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.passwordResetCode.create({
      data: { userId: user.id, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });

    const provider = await sendSms(
      phone,
      `Duel of Thought — ${code} / کد بازیابی رمز عبور شما: ${code}`,
    );

    // devCode is ONLY surfaced in sandbox/demo mode (no SMS gateway configured)
    // so the board demo can complete the flow without a carrier. In production
    // (SMS_PROVIDER_KEY set) provider.dev is false and this field is never sent.
    if (provider.dev) return NextResponse.json({ ok: true, devCode: code });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('forgot error', e);
    return NextResponse.json({ error: 'SERVER' }, { status: 500 });
  }
}
