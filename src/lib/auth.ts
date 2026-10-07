/**
 * Auth & session utilities (server-side only).
 * scrypt password hashing + opaque session tokens in httpOnly cookies.
 */
import { db } from '@/lib/db';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'doi_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    const hashBuf = Buffer.from(hash, 'hex');
    const test = scryptSync(password, salt, 64);
    return hashBuf.length === test.length && timingSafeEqual(hashBuf, test);
  } catch {
    return false;
  }
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  await db.session.create({
    data: { token: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL) },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db.session.deleteMany({ where: { token: sha256(raw) } });
  }
  store.delete(SESSION_COOKIE);
}

/** token stored hashed-at-rest so a DB leak can't hijack live sessions */
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface SafeUser {
  id: string; username: string; role: string; isGuest: boolean;
  banned: boolean; banReason: string | null; bannedUntil: string | null;
  coins: number; xp: number; level: number; rating: number;
  wins: number; losses: number; draws: number; gamesPlayed: number;
  streak: number; bestStreak: number; locale: string; bio: string;
  pieceSkin: string; boardSkin: string; background: string; effectSkin: string;
  avatarItem: string; titleItem: string | null; showcase: string[]; soundOn: boolean;
  createdAt: string;
}

export function isBanned(u: { banned: boolean; bannedUntil: Date | null }): boolean {
  if (!u.banned) return false;
  if (!u.bannedUntil) return true; // permanent
  return u.bannedUntil.getTime() > Date.now();
}

export function toSafeUser(u: {
  id: string; username: string; role: string; isGuest: boolean;
  banned: boolean; banReason: string | null; bannedUntil: Date | null;
  coins: number; xp: number; level: number; rating: number;
  wins: number; losses: number; draws: number; gamesPlayed: number;
  streak: number; bestStreak: number; locale: string; bio: string;
  pieceSkin: string; boardSkin: string; background: string; effectSkin: string;
  avatarItem: string; titleItem: string | null; showcase: string; soundOn: boolean; emotePack?: string; celebrationPack?: string; createdAt: Date;
}): SafeUser {
  let showcase: string[] = [];
  try { showcase = JSON.parse(u.showcase); } catch { /* noop */ }
  // strip secrets explicitly — never leak passwordHash or session data
  const { passwordHash: _ph, ...rest } = u as typeof u & { passwordHash?: string };
  void _ph;
  return {
    ...rest,
    bannedUntil: u.bannedUntil ? u.bannedUntil.toISOString() : null,
    showcase,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Resolve the current user from the session cookie. Returns null when anonymous. */
export async function currentUser() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const sess = await db.session.findUnique({ where: { token: sha256(raw) }, include: { user: true } });
  if (!sess) return null;
  if (sess.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { token: sess.token } }).catch(() => undefined);
    return null;
  }
  // touch lastSeen (fire & forget)
  db.user.update({ where: { id: sess.user.id }, data: { lastSeen: new Date() } }).catch(() => undefined);
  return sess.user;
}

/** Verify a raw token (used by the socket mini-service via internal API). */
export async function userByToken(rawToken: string) {
  if (!rawToken) return null;
  const sess = await db.session.findUnique({ where: { token: sha256(rawToken) }, include: { user: true } });
  if (!sess || sess.expiresAt.getTime() < Date.now()) return null;
  return sess.user;
}
