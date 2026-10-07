import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userByToken, isBanned } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Internal: socket mini-service verifies a client session token here. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const user = await userByToken(token);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (isBanned(user)) {
    return NextResponse.json({ ok: false, banned: true, reason: user.banReason ?? '' }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id, username: user.username, level: user.level, rating: user.rating,
      isGuest: user.isGuest, role: user.role,
      pieceSkin: user.pieceSkin, boardSkin: user.boardSkin,
      avatarItem: user.avatarItem, titleItem: user.titleItem,
    },
  });
}
