import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned, toSafeUser } from '@/lib/auth';
import { rateLimit } from '@/lib/ratelimit';
import { filterText, sanitizeBio } from '@/lib/moderation';
import { ACHIEVEMENTS } from '@/lib/game/content';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const PHONE_RE = /^\+?\d{7,15}$/;

const patchSchema = z.object({
  bio: z.string().max(140).optional(),
  locale: z.enum(['fa', 'en', 'ar', 'tr']).optional(),
  soundOn: z.boolean().optional(),
  showcase: z.array(z.string().max(40)).max(3).optional(),
  /** SMS recovery phone: null/"" clears, otherwise E.164-ish (validated + uniqueness-checked below) */
  phone: z.string().max(24).nullable().optional(),
});

/** Strip spaces/dashes/parens; keep a single leading +. */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (stripped.startsWith('+')) return '+' + stripped.slice(1).replace(/\+/g, '');
  return stripped;
}

export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'AUTH' }, { status: 401 });
  if (isBanned(me)) return NextResponse.json({ error: 'BANNED' }, { status: 403 });
  if (!rateLimit(`profile:${me.id}`, 20, 3600_000)) return NextResponse.json({ error: 'RATE' }, { status: 429 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const d = body.data;

  const data: Record<string, unknown> = {};
  if (d.bio !== undefined) {
    const clean = sanitizeBio(d.bio);
    if (clean.length > 0) {
      const filter = await filterText(clean);
      if (filter.maxSeverity >= 3) return NextResponse.json({ error: 'BAD_BIO', words: filter.words }, { status: 400 });
      data.bio = filter.masked;
    } else {
      data.bio = '';
    }
  }
  if (d.locale) data.locale = d.locale;
  if (d.soundOn !== undefined) data.soundOn = d.soundOn;
  if (d.showcase) {
    const valid = d.showcase.filter((id) => ACHIEVEMENTS.find((a) => a.id === id));
    data.showcase = JSON.stringify(valid.slice(0, 3));
  }
  if (d.phone !== undefined && !me.isGuest) {
    const phone = d.phone === null ? '' : normalizePhone(d.phone);
    if (phone === '') {
      data.phone = null; // clear
    } else if (PHONE_RE.test(phone)) {
      const taken = await db.user.findFirst({ where: { phone } });
      if (taken && taken.id !== me.id) return NextResponse.json({ error: 'PHONE_TAKEN' }, { status: 400 });
      if (me.phone !== phone) data.phone = phone;
    } else {
      return NextResponse.json({ error: 'PHONE_BAD' }, { status: 400 });
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'NOTHING' }, { status: 400 });

  const user = await db.user.update({ where: { id: me.id }, data });
  return NextResponse.json({ ok: true, user: toSafeUser(user) });
}

/** Public profile lookup (for leaderboards & chat profiles) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = url.searchParams.get('username');
  if (!username) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  const user = await db.user.findFirst({
    where: { OR: [{ username: username }, { usernameLower: username.toLowerCase() }] },
    select: {
      username: true, level: true, rating: true, wins: true, losses: true, draws: true,
      gamesPlayed: true, bestStreak: true, bio: true, avatarItem: true, titleItem: true,
      pieceSkin: true, createdAt: true, banned: true,
    },
  });
  if (!user || user.banned) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const achievements = await db.userAchievement.findMany({
    where: { userId: (await db.user.findFirst({ where: { username }, select: { id: true } }))?.id ?? '', unlockedAt: { not: null } },
    select: { achievementId: true, unlockedAt: true },
  });
  return NextResponse.json({ profile: { ...user, achievements: achievements.map((a) => a.achievementId) } });
}
