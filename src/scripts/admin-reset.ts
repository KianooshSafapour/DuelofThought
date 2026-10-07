/**
 * Admin account management — board-demo recovery tool.
 * Ensures the three operator accounts exist, resets their passwords,
 * clears bans and stale sessions. Idempotent — safe to re-run.
 *
 *   bun run admin:reset              → reset all three to defaults
 *   bun run admin:reset NewPass123   → also set `admin` to NewPass123
 *
 * Defaults (board demo):
 *   admin          / DuelAdmin@1404
 *   administrator  / @@3DoT14!Pi
 *   demo           / demo
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const OPERATORS: { username: string; password: string; note: string }[] = [
  { username: 'admin', password: 'DuelAdmin@1404', note: 'chief operator' },
  { username: 'administrator', password: '@@3DoT14!Pi', note: 'full operator' },
  { username: 'demo', password: 'demo', note: 'board-demo operator' },
];

async function main() {
  const override = process.argv[2];
  const rows: { username: string; password: string; note: string }[] = OPERATORS.map((o) =>
    o.username === 'admin' && override ? { ...o, password: override } : o,
  );

  for (const op of rows) {
    const existing = await db.user.findUnique({ where: { usernameLower: op.username.toLowerCase() } });
    const base = {
      username: op.username,
      usernameLower: op.username.toLowerCase(),
      passwordHash: hashPassword(op.password),
      role: 'ADMIN',
      banned: false,
      banReason: null,
      bannedUntil: null,
    };
    let user;
    if (existing) {
      user = await db.user.update({ where: { id: existing.id }, data: base });
    } else {
      user = await db.user.create({ data: { ...base, coins: 9999, isGuest: false } });
      for (const code of ['piece_terracotta', 'board_classic', 'bg_royal_velvet', 'fx_confetti', 'avatar_seedling', 'avatar_owl', 'avatar_fennec', 'emote_classic', 'celeb_confetti']) {
        await db.purchase.create({ data: { userId: user.id, itemId: code, price: 0 } }).catch(() => undefined);
      }
    }
    // force fresh sessions everywhere
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.auditLog.create({
      data: { actorId: user.id, action: 'admin_reset', targetId: user.id, details: `operator ${op.note} re-provisioned` },
    }).catch(() => undefined);
    console.log(`+ ${op.username.padEnd(14)} password: ${op.password.padEnd(16)} (${op.note})`);
  }
  console.log('\nAll operator accounts ready — stale sessions cleared.');
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
