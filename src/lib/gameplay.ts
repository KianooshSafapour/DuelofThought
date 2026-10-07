/**
 * Server-side gameplay: applies a finished game to the economy.
 * Coins/XP/level curve, hourly anti-farm caps, daily quests, achievements, ELO.
 * Shared by /api/game/submit (PVE & local PvP) and /api/mp/result (online).
 */
import { db } from '@/lib/db';
import { computeRewards, eloDeltas, levelFromXp, ACHIEVEMENTS, questsForDay, xpForLevel } from '@/lib/game/content';
import { LEVEL_UP_COIN_BONUS } from '@/lib/constants';

export interface ApplyOutcome {
  coins: number;
  xp: number;
  eloDelta: number | null;
  levelUps: number;
  unlockedAchievements: { id: string; coins: number; rarity: string; icon: string }[];
  completedQuests: { id: string; reward: number }[];
  user: {
    coins: number; xp: number; level: number; rating: number; wins: number; losses: number;
    draws: number; gamesPlayed: number; streak: number; bestStreak: number;
  };
}

export interface ApplyGameInput {
  userId: string;
  mode: 'PVE' | 'LOCAL_PVP' | 'ONLINE';
  ranked?: boolean;
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  aiLevel?: 'EASY' | 'MEDIUM' | 'HARD';
  winType?: 'KIND' | 'RUN' | null;
  moves: number;
  durationMs: number;
  boardId: string;
  firstMoveCol: number;
  endReason: string;
  /** for ONLINE two-human results; null for PVE/local (single requesting user) */
  opponentId?: string | null;
  opponentOutcome?: 'WIN' | 'LOSS' | 'DRAW';
  opponentRating?: number;
  userRating?: number;
  movesSummary?: Record<string, unknown>;
}

function dateKeyTehran(now = new Date()): string {
  const t = new Date(now.getTime() + 3.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** hourly caps to make farming pointless */
async function coinsEarnedLastHour(userId: string, mode: string): Promise<number> {
  const rows = await db.gameResult.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 3600_000) },
      mode,
      OR: [{ p1Id: userId }, { p2Id: userId }],
    },
    select: { movesData: true, coinsAwarded: true },
  });
  let sum = 0;
  for (const r of rows) {
    try {
      const md = JSON.parse(r.movesData) as { awards?: Record<string, number> };
      const a = md.awards?.[userId];
      if (typeof a === 'number') sum += a;
      else if (r.movesData === '{}') sum += r.coinsAwarded; // legacy single-user rows
    } catch { /* skip */ }
  }
  return sum;
}

const CAPS: Record<string, number> = { PVE: 350, LOCAL_PVP: 40, ONLINE: 1200 };

async function ensureQuests(userId: string) {
  const dk = dateKeyTehran();
  const defs = questsForDay(dk, userId);
  for (const q of defs) {
    await db.userQuest.upsert({
      where: { userId_questId_dateKey: { userId, questId: q.id, dateKey: dk } },
      create: { userId, questId: q.id, dateKey: dk, goal: q.goal, reward: q.reward },
      update: {},
    });
  }
  return { dk, defs };
}

async function bumpQuest(userId: string, dk: string, metric: string, by: number) {
  // map metric -> questIds via content defs
  const defs = questsForDay(dk, userId);
  const ids = defs.filter((d) => d.metric === metric).map((d) => d.id);
  const completed: { id: string; reward: number }[] = [];
  for (const qid of ids) {
    const q = await db.userQuest.update({
      where: { userId_questId_dateKey: { userId, questId: qid, dateKey: dk } },
      data: { progress: { increment: by } },
    });
    if (q.progress >= q.goal) completed.push({ id: qid, reward: q.reward });
  }
  return completed;
}

export async function applyGameResult(input: ApplyGameInput): Promise<ApplyOutcome> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new Error('user not found');

  /* ---------------- rewards with caps ---------------- */
  const base = computeRewards({
    mode: input.mode, outcome: input.outcome, aiLevel: input.aiLevel,
    ranked: input.ranked, moves: input.moves, streak: user.streak,
  });
  const earnedLastHour = await coinsEarnedLastHour(user.id, input.mode);
  const capLeft = Math.max(0, CAPS[input.mode] - earnedLastHour);
  const coins = Math.min(base.coins, capLeft);
  const xp = base.xp;

  /* ---------------- ELO (ranked online only) ---------------- */
  let eloDelta: number | null = null;
  if (input.mode === 'ONLINE' && input.ranked && input.opponentRating != null && input.userRating != null) {
    const score = input.outcome === 'WIN' ? 1 : input.outcome === 'DRAW' ? 0.5 : 0;
    const [d1] = eloDeltas(input.userRating, input.opponentRating, score);
    eloDelta = d1;
  }

  /* ---------------- user stat update ---------------- */
  const streak = input.outcome === 'WIN' ? user.streak + 1 : 0;
  let newXp = user.xp + xp;
  let newLevel = levelFromXp(newXp).level;
  let levelUps = Math.max(0, newLevel - user.level);
  let bonusCoins = coins + levelUps * LEVEL_UP_COIN_BONUS;

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      coins: { increment: bonusCoins },
      xp: newXp,
      level: newLevel,
      rating: eloDelta ? Math.max(100, user.rating + eloDelta) : undefined,
      wins: input.outcome === 'WIN' ? { increment: 1 } : undefined,
      losses: input.outcome === 'LOSS' ? { increment: 1 } : undefined,
      draws: input.outcome === 'DRAW' ? { increment: 1 } : undefined,
      gamesPlayed: { increment: 1 },
      streak,
      bestStreak: Math.max(user.bestStreak, streak),
      lastSeen: new Date(),
    },
  });
  newXp = updated.xp; newLevel = updated.level;

  /* ---------------- quests ---------------- */
  await ensureQuests(user.id);
  const dk = dateKeyTehran();
  const completed: { id: string; reward: number }[] = [];
  const push = (arr: { id: string; reward: number }[]) => { for (const c of arr) if (!completed.find((x) => x.id === c.id)) completed.push(c); };
  push(await bumpQuest(user.id, dk, 'games', 1));
  if (input.moves > 0) push(await bumpQuest(user.id, dk, 'moves', Math.min(input.moves, 63)));
  if (input.outcome === 'WIN') push(await bumpQuest(user.id, dk, 'wins', 1));
  if (input.winType === 'KIND') push(await bumpQuest(user.id, dk, 'kindWin', 1));
  if (input.winType === 'RUN') push(await bumpQuest(user.id, dk, 'runWin', 1));
  if (input.outcome === 'DRAW') push(await bumpQuest(user.id, dk, 'drawGame', 1));
  if (input.mode === 'ONLINE') push(await bumpQuest(user.id, dk, 'onlineGames', 1));
  if (input.mode === 'PVE') {
    if (input.outcome === 'WIN') push(await bumpQuest(user.id, dk, 'pveWins', 1));
    if (input.outcome === 'WIN' && input.aiLevel === 'HARD') push(await bumpQuest(user.id, dk, 'hardWin', 1));
  }
  if (input.mode === 'LOCAL_PVP') push(await bumpQuest(user.id, dk, 'localGames', 1));

  // quest completion coins (claim-based; here just mark completable — claiming grants coins)
  /* ---------------- achievements ---------------- */
  const [kindWins, runWins, hardWins, onlineWins, itemsOwned, questsDone, drawCount] = await Promise.all([
    db.gameResult.count({ where: { endReason: 'KIND', OR: [{ AND: [{ p1Id: user.id }, { winner: 'P1' }] }, { AND: [{ p2Id: user.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { endReason: 'RUN', OR: [{ AND: [{ p1Id: user.id }, { winner: 'P1' }] }, { AND: [{ p2Id: user.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { aiLevel: 'HARD', endReason: { in: ['KIND', 'RUN'] }, OR: [{ AND: [{ p1Id: user.id }, { winner: 'P1' }] }, { AND: [{ p2Id: user.id }, { winner: 'P2' }] }] } }),
    db.gameResult.count({ where: { mode: 'ONLINE', OR: [{ AND: [{ p1Id: user.id }, { winner: 'P1' }] }, { AND: [{ p2Id: user.id }, { winner: 'P2' }] }] } }),
    db.purchase.count({ where: { userId: user.id } }),
    db.userQuest.count({ where: { userId: user.id, claimed: true } }),
    db.gameResult.count({ where: { winner: 'DRAW', OR: [{ p1Id: user.id }, { p2Id: user.id }] } }),
  ]);

  const metrics: Record<string, number> = {
    wins: updated.wins, kindWins, runWins, games: updated.gamesPlayed,
    onlineWins, onlineGames: onlineWins, hardWins, streakBest: updated.bestStreak,
    itemsOwned, level: updated.level, questsDone, draws: drawCount,
  };

  const unlocked: { id: string; coins: number; rarity: string; icon: string }[] = [];
  const existing = await db.userAchievement.findMany({ where: { userId: user.id } });
  const have = new Map(existing.map((e) => [e.achievementId, e]));
  for (const def of ACHIEVEMENTS) {
    const val = metrics[def.metric] ?? 0;
    const cur = have.get(def.id);
    const justReached = val >= def.goal && (!cur || !cur.unlockedAt);
    await db.userAchievement.upsert({
      where: { userId_achievementId: { userId: user.id, achievementId: def.id } },
      create: { userId: user.id, achievementId: def.id, progress: Math.min(val, def.goal), unlockedAt: justReached ? new Date() : null },
      update: { progress: Math.min(val, def.goal), unlockedAt: justReached && (!cur || !cur.unlockedAt) ? new Date() : (cur?.unlockedAt ?? null) },
    });
    if (justReached && (!cur || !cur.unlockedAt)) {
      unlocked.push({ id: def.id, coins: def.coins, rarity: def.rarity, icon: def.icon });
      // grant achievement reward coins immediately
      const au = await db.user.update({ where: { id: user.id }, data: { coins: { increment: def.coins } } });
      updated.coins = au.coins;
    }
  }

  /* ---------------- analytics ---------------- */
  await db.analyticsEvent.create({
    data: {
      userId: user.id,
      type: `game_${input.mode.toLowerCase()}`,
      payload: JSON.stringify({ outcome: input.outcome, winType: input.winType, moves: input.moves, boardId: input.boardId, firstMoveCol: input.firstMoveCol, aiLevel: input.aiLevel, durationMs: input.durationMs }),
    },
  });

  return {
    coins: bonusCoins,
    xp,
    eloDelta,
    levelUps,
    unlockedAchievements: unlocked,
    completedQuests: completed,
    user: {
      coins: updated.coins, xp: updated.xp, level: updated.level, rating: updated.rating,
      wins: updated.wins, losses: updated.losses, draws: updated.draws,
      gamesPlayed: updated.gamesPlayed, streak: updated.streak, bestStreak: updated.bestStreak,
    },
  };
}

/** Persist a GameResult row (with per-user award bookkeeping for caps). */
export async function recordGameResult(d: {
  mode: string; ranked: boolean; boardId: string; winner: string; endReason: string;
  winNumbers: number[]; p1Id?: string | null; p2Id?: string | null; aiLevel?: string | null;
  p1Name: string; p2Name: string; moves: number; firstMoveCol: number; durationMs: number;
  movesData?: Record<string, unknown>;
  p1RatingDelta?: number; p2RatingDelta?: number;
  coinsAwarded?: number; xpAwarded?: number;
}) {
  return db.gameResult.create({
    data: {
      mode: d.mode, ranked: d.ranked, boardId: d.boardId, winner: d.winner, endReason: d.endReason,
      winNumbers: JSON.stringify(d.winNumbers ?? []),
      p1Id: d.p1Id ?? null, p2Id: d.p2Id ?? null, aiLevel: d.aiLevel ?? null,
      p1Name: d.p1Name, p2Name: d.p2Name,
      moves: d.moves, firstMoveCol: d.firstMoveCol, durationMs: d.durationMs,
      movesData: JSON.stringify(d.movesData ?? {}),
      p1RatingDelta: d.p1RatingDelta ?? 0, p2RatingDelta: d.p2RatingDelta ?? 0,
      coinsAwarded: d.coinsAwarded ?? 0, xpAwarded: d.xpAwarded ?? 0,
    },
  });
}
