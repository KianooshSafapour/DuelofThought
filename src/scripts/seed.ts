/**
 * Database seeder: admin account, store catalog, demo leaderboard players,
 * welcome announcement, starter word-filter list. Idempotent.
 * Run: bun run src/scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'crypto';
import { STORE_ITEMS } from '../lib/game/content';

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function upsertUser(d: {
  username: string; password: string; role?: string; coins?: number; xp?: number;
  rating?: number; wins?: number; losses?: number; draws?: number; streak?: number;
  pieceSkin?: string; boardSkin?: string; background?: string; avatarItem?: string; titleItem?: string | null;
}) {
  const data = {
    username: d.username,
    usernameLower: d.username.toLowerCase(),
    passwordHash: hashPassword(d.password),
    role: d.role ?? 'PLAYER',
    coins: d.coins ?? 250,
    xp: d.xp ?? 0,
    rating: d.rating ?? 1000,
    wins: d.wins ?? 0,
    losses: d.losses ?? 0,
    draws: d.draws ?? 0,
    streak: d.streak ?? 0,
    bestStreak: d.streak ?? 0,
    gamesPlayed: (d.wins ?? 0) + (d.losses ?? 0) + (d.draws ?? 0),
    pieceSkin: d.pieceSkin ?? 'piece_terracotta',
    boardSkin: d.boardSkin ?? 'board_classic',
    background: d.background ?? 'bg_royal_velvet',
    avatarItem: d.avatarItem ?? 'avatar_seedling',
    titleItem: d.titleItem ?? null,
  };
  return db.user.upsert({
    where: { usernameLower: data.usernameLower },
    create: data,
    update: {
      role: data.role, coins: data.coins, xp: data.xp, rating: data.rating,
      wins: data.wins, losses: data.losses, draws: data.draws,
      streak: data.streak, bestStreak: data.bestStreak, gamesPlayed: data.gamesPlayed,
      pieceSkin: data.pieceSkin, boardSkin: data.boardSkin, background: data.background,
      avatarItem: data.avatarItem, titleItem: data.titleItem,
    },
  });
}

async function main() {
  const adminPass = process.env.ADMIN_PASSWORD ?? 'DuelAdmin@1404';
  await upsertUser({ username: 'admin', password: adminPass, role: 'ADMIN', coins: 9999, avatarItem: 'avatar_moon', titleItem: 'title_legend' });
  console.log('+ admin seeded (username: admin)');
  // board-demo operator accounts (v0.4.0-alpha) — never locked out again
  await upsertUser({ username: 'administrator', password: '@@3DoT14!Pi', role: 'ADMIN', coins: 9999, avatarItem: 'avatar_moon' });
  await upsertUser({ username: 'demo', password: 'demo', role: 'ADMIN', coins: 9999, avatarItem: 'avatar_owl' });
  console.log('+ administrator / demo operators seeded');

  for (const [i, it] of STORE_ITEMS.entries()) {
    await db.storeItem.upsert({
      where: { code: it.code },
      create: { code: it.code, category: it.category, rarity: it.rarity, price: it.price, requiredLevel: it.requiredLevel, data: JSON.stringify(it.data), sortOrder: i },
      update: { category: it.category, rarity: it.rarity, price: it.price, requiredLevel: it.requiredLevel, data: JSON.stringify(it.data), sortOrder: i },
    });
  }
  const admin = await db.user.findUnique({ where: { usernameLower: 'admin' } });
  if (admin) {
    for (const code of ['piece_terracotta', 'board_classic', 'bg_royal_velvet', 'fx_confetti', 'avatar_seedling', 'avatar_owl', 'avatar_fennec']) {
      await db.purchase.upsert({
        where: { userId_itemId: { userId: admin.id, itemId: code } },
        create: { userId: admin.id, itemId: code, price: 0 },
        update: {},
      });
    }
  }
  console.log(`+ ${STORE_ITEMS.length} store items seeded`);

  const demo = [
    { username: 'آریا_مهر', rating: 1432, wins: 84, losses: 39, draws: 12, streak: 6, xp: 5200, pieceSkin: 'piece_aurora', avatarItem: 'avatar_shir', titleItem: 'title_quad' },
    { username: 'PixelShah', rating: 1385, wins: 77, losses: 41, draws: 9, streak: 3, xp: 4700, pieceSkin: 'piece_prism', avatarItem: 'avatar_bot', boardSkin: 'board_neon' },
    { username: 'ستاره_شناس', rating: 1310, wins: 65, losses: 44, draws: 15, streak: 4, xp: 4100, avatarItem: 'avatar_moon', background: 'bg_starfield' },
    { username: 'MathQueen', rating: 1266, wins: 59, losses: 37, draws: 11, streak: 5, xp: 3800, pieceSkin: 'piece_royal', avatarItem: 'avatar_lotus', titleItem: 'title_mathematician' },
    { username: 'طوفان_فکر', rating: 1198, wins: 51, losses: 48, draws: 8, streak: 2, xp: 3300, boardSkin: 'board_crimson', avatarItem: 'avatar_fennec' },
    { username: 'Zarbaten', rating: 1150, wins: 45, losses: 39, draws: 14, streak: 1, xp: 2900, avatarItem: 'avatar_owl' },
    { username: 'یخ_ملکه', rating: 1092, wins: 38, losses: 41, draws: 10, streak: 2, xp: 2400, pieceSkin: 'piece_obsidian' },
    { username: 'KavirFox', rating: 1043, wins: 31, losses: 36, draws: 9, streak: 0, xp: 2000, avatarItem: 'avatar_fennec', background: 'bg_dunes' },
  ];
  for (const d of demo) await upsertUser({ password: randomBytes(18).toString('base64url'), ...d });
  console.log('+ demo players seeded');

  const allCodes = STORE_ITEMS.map((s) => s.code);
  for (const d of demo) {
    const u = await db.user.findUnique({ where: { usernameLower: d.username.toLowerCase() } });
    if (!u) continue;
    const owned = new Set(['piece_terracotta', 'board_classic', 'bg_royal_velvet', 'fx_confetti', 'avatar_seedling', 'avatar_owl', 'avatar_fennec']);
    const eq = [d.pieceSkin, d.avatarItem, d.boardSkin, d.background, d.titleItem].filter(Boolean) as string[];
    for (const code of [...owned, ...eq]) {
      if (!allCodes.includes(code)) continue;
      await db.purchase.upsert({
        where: { userId_itemId: { userId: u.id, itemId: code } },
        create: { userId: u.id, itemId: code, price: 0 },
        update: {},
      });
    }
  }

  const annCount = await db.announcement.count();
  if (annCount === 0) {
    await db.announcement.create({
      data: {
        titleFa: 'به پارک دوئل ایده‌ها خوش آمدید!', titleEn: 'Welcome to Duel of Ideas Park!',
        titleAr: 'مرحبا بكم في حديقة مبارزة الأفكار!', titleTr: "Fikir Düellosu Parkı'na hoş geldiniz!",
        bodyFa: 'با ۲۵۰ سکهٔ هدیه شروع کنید، مهره‌ها و صفحه‌های تازه بخرید و در جدول امتیازات بدرخشید. چالش روز هر شب تازه می‌شود!',
        bodyEn: 'Start with a 250-coin gift, buy new pieces and boards, and shine on the leaderboard. The daily challenge rotates every midnight!',
        bodyAr: 'ابدأ بـ ٢٥٠ عملة هدية، واشتر قطعا ولوحات جديدة، وتألق في لوحة النقاط!',
        bodyTr: "250 altın hediyesiyle başla, yeni taşlar ve tahtalar satın al, sıralamada parla!",
        kind: 'EVENT',
      },
    });
    console.log('+ welcome announcement seeded');
  }

  const starterWords: [string, number][] = [
    ['احمق', 1], ['خنگ', 1], ['بی‌شعور', 2], ['حيوان', 2], ['كلب', 2],
    ['stupid', 1], ['idiot', 1], ['dumb', 1], ['hate you', 2], ['scam', 2],
    ['غبي', 2], ['سافل', 2], ['aptal', 1], ['salak', 1], ['gerizekalı', 2],
  ];
  for (const [w, sev] of starterWords) {
    await db.bannedWord.upsert({ where: { word: w }, create: { word: w, severity: sev }, update: { severity: sev } });
  }
  console.log('+ word filter seeded');
  console.log('+ seed complete');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
