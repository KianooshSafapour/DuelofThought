/**
 * Boulder Yard — driver identity & machine garage (Task B1).
 *
 * A persistent, localStorage-backed progression layer shared by BOTH Boulder
 * Yard games: one wallet, one driver level, one garage. Level layouts stay
 * untouched — the starter Old Tractor (power 1, no abilities) can clear every
 * solver-verified level, so machines & upgrades are power-savers, never gates.
 *
 * Economy (per level completion):
 *  - money: first clear 40 + 10·levelNumber · replay 30% of base · +15/star
 *  - driver XP: 25 + 12·stars
 * Driver level curve: advancing from level N needs 100 + 60·(N−1) XP.
 * Upgrade cost: 250 · (tier+1) · (statIndex+1), statIndex power=0, dig=1, lift=2.
 * Every stat is capped at max(2, base) — a fully-upgraded Old Tractor reaches
 * exactly power 2 / dig 2 / lift 2, and high-tier machines are never nerfed.
 */

export type StatKey = 'power' | 'dig' | 'lift';
export type MachineKind = 'tractor' | 'tractor_flat' | 'dozer' | 'excavator' | 'forklift' | 'loader';

export interface MachineDef {
  id: string;
  /** sprite family (CSS art) */
  kind: MachineKind;
  price: number;
  /** driver level gate */
  requiredLevel: number;
  base: Record<StatKey, number>;
  /** purely cosmetic game-feel multiplier (move animation speed) */
  speed: number;
  /** CSS-art accent hue (0-360) */
  hue: number;
  /** CSS-art scale (bigger = heavier machine) */
  size: number;
}

export interface GarageState {
  money: number;
  driverXp: number;
  driverLevel: number;
  ownedMachines: string[];
  selected: string;
  /** `${machineId}:${stat}` -> tier (0..MAX_TIER) */
  upgrades: Record<string, number>;
}

export const GARAGE_KEY = 'doi_boulder_garage_v1';
export const STARTER_ID = 'tractor_old';
export const MAX_TIER = 2;
/** stats never exceed this (or their base, when the base is higher) */
export const STAT_CAP = 2;
export const STAT_KEYS: StatKey[] = ['power', 'dig', 'lift'];

/* ----------------------------- machine roster ----------------------------- */
export const MACHINES: MachineDef[] = [
  { id: 'tractor_old', kind: 'tractor', price: 0, requiredLevel: 1, base: { power: 1, dig: 0, lift: 0 }, speed: 1, hue: 210, size: 0.9 },
  { id: 'tractor_flat', kind: 'tractor_flat', price: 300, requiredLevel: 2, base: { power: 1, dig: 1, lift: 0 }, speed: 1.05, hue: 145, size: 0.98 },
  { id: 'dozer_x1', kind: 'dozer', price: 900, requiredLevel: 4, base: { power: 2, dig: 0, lift: 0 }, speed: 0.95, hue: 25, size: 1.06 },
  { id: 'digger_300', kind: 'excavator', price: 1600, requiredLevel: 6, base: { power: 1, dig: 3, lift: 0 }, speed: 0.9, hue: 50, size: 1.04 },
  { id: 'forklift', kind: 'forklift', price: 2200, requiredLevel: 8, base: { power: 1, dig: 0, lift: 3 }, speed: 1.15, hue: 200, size: 0.88 },
  { id: 'loader_wheel', kind: 'loader', price: 3400, requiredLevel: 11, base: { power: 2, dig: 1, lift: 1 }, speed: 1.05, hue: 95, size: 1.08 },
  { id: 'dozer_quarry', kind: 'dozer', price: 5200, requiredLevel: 15, base: { power: 3, dig: 0, lift: 0 }, speed: 0.85, hue: 0, size: 1.14 },
  { id: 'titan_loader', kind: 'loader', price: 9000, requiredLevel: 20, base: { power: 3, dig: 2, lift: 2 }, speed: 0.9, hue: 265, size: 1.2 },
];

export function getMachine(id: string): MachineDef {
  return MACHINES.find((m) => m.id === id) ?? MACHINES[0];
}

/* ------------------------------ driver levels ----------------------------- */
/** XP needed to advance FROM `level` to level+1 (100 + 60·(N−1)). */
export function xpToNext(level: number): number {
  return 100 + 60 * (level - 1);
}

/** Total XP required to REACH `level` (level 1 = 0). */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xp >= totalXpForLevel(level + 1) && level < 99) level += 1;
  return level;
}

/** progress 0..1 toward the next driver level (1 at cap) */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  const cur = xp - totalXpForLevel(level);
  const need = xpToNext(level);
  return Math.max(0, Math.min(1, cur / need));
}

/* --------------------------------- stats ---------------------------------- */
export function upgradeTier(g: GarageState, machineId: string, stat: StatKey): number {
  return g.upgrades[`${machineId}:${stat}`] ?? 0;
}

export function statCap(m: MachineDef, stat: StatKey): number {
  return Math.max(STAT_CAP, m.base[stat]);
}

export function effectiveStat(m: MachineDef, g: GarageState, stat: StatKey): number {
  const tier = upgradeTier(g, m.id, stat);
  return Math.min(m.base[stat] + tier, statCap(m, stat));
}

export function effectiveStats(m: MachineDef, g: GarageState): Record<StatKey, number> {
  return { power: effectiveStat(m, g, 'power'), dig: effectiveStat(m, g, 'dig'), lift: effectiveStat(m, g, 'lift') };
}

/** cost to buy the NEXT tier (tier = current tier): 250·(tier+1)·(statIndex+1) */
export function upgradeCost(m: MachineDef, stat: StatKey, currentTier: number): number {
  const statIndex = STAT_KEYS.indexOf(stat);
  return 250 * (currentTier + 1) * (statIndex + 1);
}

/* ------------------------------ persistence ------------------------------- */
function sanitize(raw: unknown): GarageState {
  const g = raw as Partial<GarageState> | null;
  const owned = Array.isArray(g?.ownedMachines) && g.ownedMachines.length > 0 ? g.ownedMachines.filter((x) => typeof x === 'string') : [STARTER_ID];
  const ownedSet = new Set(owned);
  if (!ownedSet.has(STARTER_ID)) { ownedSet.add(STARTER_ID); owned.push(STARTER_ID); }
  const selected = typeof g?.selected === 'string' && ownedSet.has(g.selected) ? g.selected : STARTER_ID;
  const upgrades: Record<string, number> = {};
  if (g?.upgrades && typeof g.upgrades === 'object') {
    for (const [k, v] of Object.entries(g.upgrades)) {
      if (typeof v === 'number' && v >= 0 && v <= MAX_TIER) upgrades[k] = Math.floor(v);
    }
  }
  return {
    money: Math.max(0, Math.floor(typeof g?.money === 'number' ? g.money : 0)),
    driverXp: Math.max(0, Math.floor(typeof g?.driverXp === 'number' ? g.driverXp : 0)),
    driverLevel: 0, // recomputed below from XP
    ownedMachines: owned,
    selected,
    upgrades,
  };
}

export function loadGarage(): GarageState {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (raw) {
      const g = sanitize(JSON.parse(raw));
      g.driverLevel = levelForXp(g.driverXp); // level always derives from XP
      return g;
    }
  } catch { /* fresh device / private mode */ }
  return freshGarage();
}

export function freshGarage(): GarageState {
  return { money: 0, driverXp: 0, driverLevel: 1, ownedMachines: [STARTER_ID], selected: STARTER_ID, upgrades: {} };
}

export function saveGarage(g: GarageState): void {
  try { localStorage.setItem(GARAGE_KEY, JSON.stringify(g)); } catch { /* private mode */ }
}

/* -------------------------------- rewards --------------------------------- */
export interface CompletionReward { money: number; xp: number; firstClear: boolean }

/** money/xp for finishing level `levelNumber` (1-based) with `stars` stars. */
export function completionReward(levelNumber: number, stars: number, firstClear: boolean): CompletionReward {
  const base = 40 + 10 * levelNumber;
  const money = (firstClear ? base : Math.round(base * 0.3)) + 15 * stars;
  const xp = 25 + 12 * stars;
  return { money, xp, firstClear };
}

/** apply a completion reward; returns { garage, levelUp } (level derives from xp) */
export function applyReward(g: GarageState, r: CompletionReward): { garage: GarageState; levelUp: number } {
  const driverXp = g.driverXp + r.xp;
  const driverLevel = levelForXp(driverXp);
  return {
    garage: { ...g, money: g.money + r.money, driverXp, driverLevel },
    levelUp: Math.max(0, driverLevel - g.driverLevel),
  };
}

/* ------------------------------ shop actions ------------------------------ */
export function canBuy(g: GarageState, m: MachineDef): { ok: boolean; reason: 'level' | 'money' | 'owned' | null } {
  if (g.ownedMachines.includes(m.id)) return { ok: false, reason: 'owned' };
  if (g.driverLevel < m.requiredLevel) return { ok: false, reason: 'level' };
  if (g.money < m.price) return { ok: false, reason: 'money' };
  return { ok: true, reason: null };
}

export function buyMachine(g: GarageState, m: MachineDef): GarageState | null {
  if (!canBuy(g, m).ok) return null;
  return { ...g, money: g.money - m.price, ownedMachines: [...g.ownedMachines, m.id], selected: m.id };
}

export function selectMachine(g: GarageState, id: string): GarageState {
  if (!g.ownedMachines.includes(id)) return g;
  return { ...g, selected: id };
}

export function nextUpgradeTier(g: GarageState, m: MachineDef, stat: StatKey): number | null {
  const tier = upgradeTier(g, m.id, stat);
  if (tier >= MAX_TIER) return null;
  if (m.base[stat] + tier >= statCap(m, stat)) return null; // already at cap
  return tier;
}

export function buyUpgrade(g: GarageState, m: MachineDef, stat: StatKey): GarageState | null {
  const tier = nextUpgradeTier(g, m, stat);
  if (tier === null) return null;
  const cost = upgradeCost(m, stat, tier);
  if (g.money < cost) return null;
  return { ...g, money: g.money - cost, upgrades: { ...g.upgrades, [`${m.id}:${stat}`]: tier + 1 } };
}
