/**
 * Game content catalog: store items (skins/avatars/backgrounds/titles/effects),
 * achievements, daily quests, rarity tiers. Item `data` JSON drives the
 * procedural pixel-art renderer (client) so no binary art assets are needed.
 */
import { CHARACTERS } from './cheese-data';


export type Rarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'ULTIMATE';
export type ItemCategory = 'PIECE' | 'BOARD' | 'AVATAR' | 'BACKGROUND' | 'EFFECT' | 'TITLE' | 'EMOTE' | 'CELEBRATION';

export interface ItemDef {
  code: string;
  category: ItemCategory;
  rarity: Rarity;
  price: number;
  requiredLevel: number;
  data: Record<string, unknown>;
}

export const RARITY_META: Record<Rarity, { color: string; glow: string; order: number }> = {
  COMMON: { color: '#9ca3af', glow: 'rgba(156,163,175,.35)', order: 0 },
  RARE: { color: '#34d399', glow: 'rgba(52,211,153,.4)', order: 1 },
  EPIC: { color: '#c084fc', glow: 'rgba(192,132,252,.45)', order: 2 },
  LEGENDARY: { color: '#fbbf24', glow: 'rgba(251,191,36,.55)', order: 3 },
  ULTIMATE: { color: '#f43f5e', glow: 'rgba(244,63,94,.6)', order: 4 },
};

/** Every piece skin defines palettes for BOTH sides + a pixel pattern seed. */
const piece = (code: string, rarity: Rarity, price: number, p1: string[], p2: string[], seed: number, nameGlow?: string): ItemDef =>
  ({ code, category: 'PIECE', rarity, price, requiredLevel: rarity === 'ULTIMATE' ? 12 : rarity === 'LEGENDARY' ? 6 : rarity === 'EPIC' ? 3 : 1, data: { p1, p2, seed, glow: nameGlow ?? p1[0] } });

const avatar = (code: string, rarity: Rarity, price: number, seed: number, pal: string[]): ItemDef =>
  ({ code, category: 'AVATAR', rarity, price, requiredLevel: 1, data: { seed, pal } });

const bg = (code: string, rarity: Rarity, price: number, kind: string, colors: string[], accent: string): ItemDef =>
  ({ code, category: 'BACKGROUND', rarity, price, requiredLevel: 1, data: { kind, colors, accent } });

const board = (code: string, rarity: Rarity, price: number, pal: Record<string, string>): ItemDef =>
  ({ code, category: 'BOARD', rarity, price, requiredLevel: rarity === 'ULTIMATE' ? 12 : rarity === 'EPIC' ? 3 : 1, data: pal });

const fx = (code: string, rarity: Rarity, price: number, colors: string[], shape: string): ItemDef =>
  ({ code, category: 'EFFECT', rarity, price, requiredLevel: 1, data: { colors, shape } });

const title = (code: string, rarity: Rarity, price: number, reqLevel: number): ItemDef =>
  ({ code, category: 'TITLE', rarity, price, requiredLevel: reqLevel, data: {} });

export const STORE_ITEMS: ItemDef[] = [
  /* ---------- EMOTE PACKS (functional: swaps the in-duel emote bar) ---------- */
  { code: 'emote_classic', category: 'EMOTE', rarity: 'COMMON', price: 0, requiredLevel: 1, data: { emotes: [
    { id: 'gg', emoji: '🤝' }, { id: 'oops', emoji: '😅' }, { id: 'hurry', emoji: '⏰' }, { id: 'thanks', emoji: '🙏' }, { id: 'laugh', emoji: '😄' },
  ] } },
  { code: 'emote_scholar', category: 'EMOTE', rarity: 'RARE', price: 600, requiredLevel: 3, data: { emotes: [
    { id: 'bow', emoji: '🙇' }, { id: 'quill', emoji: '🪶' }, { id: 'scroll', emoji: '📜' }, { id: 'lamp', emoji: '🪔' }, { id: 'brain', emoji: '🧠' },
  ] } },
  { code: 'emote_cosmos', category: 'EMOTE', rarity: 'EPIC', price: 1500, requiredLevel: 6, data: { emotes: [
    { id: 'zoom', emoji: '🚀' }, { id: 'twinkle', emoji: '🌟' }, { id: 'comet', emoji: '☄️' }, { id: 'wonder', emoji: '🛰️' }, { id: 'ringed', emoji: '🪐' },
  ] } },
  { code: 'emote_silkroad', category: 'EMOTE', rarity: 'LEGENDARY', price: 2800, requiredLevel: 9, data: { emotes: [
    { id: 'camel', emoji: '🐪' }, { id: 'strings', emoji: '🪕' }, { id: 'teapot', emoji: '🫖' }, { id: 'spice', emoji: '🫙' }, { id: 'falcon', emoji: '🦅' },
  ] } },

  /* ---------- v0.2 UNIQUE COLLECTION ---------- */

  /* ---------- PIECES ---------- */
  piece('piece_terracotta', 'COMMON', 0, ['#e8965a', '#c96f3b', '#f7c59f'], ['#7fc8a9', '#4e9d7d', '#c9ecd9'], 19041),
  piece('piece_rose', 'COMMON', 180, ['#f472b6', '#be185d', '#fbcfe8'], ['#a3e635', '#4d7c0f', '#d9f99d'], 28411),
  piece('piece_jade', 'COMMON', 200, ['#34d399', '#065f46', '#a7f3d0'], ['#fb923c', '#c2410c', '#fed7aa'], 33729),
  piece('piece_royal', 'RARE', 520, ['#c084fc', '#6b21a8', '#e9d5ff'], ['#fbbf24', '#b45309', '#fde68a'], 41593, '#c084fc'),
  piece('piece_obsidian', 'RARE', 600, ['#e5e7eb', '#4b5563', '#9ca3af'], ['#f59e0b', '#78350f', '#fcd34d'], 51017),
  piece('piece_sunset', 'RARE', 650, ['#fb7185', '#9f1239', '#fecdd3'], ['#fbbf24', '#92400e', '#fef3c7'], 62201),
  piece('piece_aurora', 'EPIC', 1400, ['#5eead4', '#0f766e', '#99f6e4'], ['#f9a8d4', '#9d174d', '#fbcfe8'], 71413, '#5eead4'),
  piece('piece_firoozeh', 'EPIC', 1500, ['#2dd4bf', '#0f766e', '#99f6e4'], ['#fda4af', '#9f1239', '#fecdd3'], 87209, '#2dd4bf'), // Persian turquoise
  piece('piece_pharaoh', 'EPIC', 1600, ['#fcd34d', '#92400e', '#fef9c3'], ['#a8a29e', '#44403c', '#e7e5e4'], 83021),
  piece('piece_prism', 'LEGENDARY', 4200, ['#f43f5e', '#f59e0b', '#10b981'], ['#8b5cf6', '#ec4899', '#14b8a6'], 99123, '#f43f5e'),

  /* ---------- BOARDS ---------- */
  board('board_classic', 'COMMON', 0, { frame: '#b98a4e', frame2: '#8f6534', cell: '#e3b878', cell2: '#d9a860', line: '#7a5226', numeral: '#4a2e12', hole: '#faf6ee', grass: '#5c9e54' }),
  board('board_royal', 'RARE', 700, { frame: '#4c1d95', frame2: '#2e1065', cell: '#6d28d9', cell2: '#5b21b6', line: '#c4b5fd', numeral: '#fde68a', hole: '#efe9ff', grass: '#8b5cf6' }),
  board('board_jade', 'RARE', 750, { frame: '#065f46', frame2: '#022c22', cell: '#10b981', cell2: '#059669', line: '#a7f3d0', numeral: '#ecfdf5', hole: '#f0fdf4', grass: '#34d399' }),
  board('board_desert', 'RARE', 700, { frame: '#b45309', frame2: '#78350f', cell: '#f59e0b', cell2: '#d97706', line: '#fde68a', numeral: '#7c2d12', hole: '#fffbeb', grass: '#fbbf24' }),
  board('board_neon', 'EPIC', 1500, { frame: '#18181b', frame2: '#000000', cell: '#27272a', cell2: '#1f1f23', line: '#f0abfc', numeral: '#5eead4', hole: '#09090b', grass: '#e879f9' }),
  board('board_marble', 'EPIC', 1600, { frame: '#94a3b8', frame2: '#475569', cell: '#e2e8f0', cell2: '#cbd5e1', line: '#64748b', numeral: '#1e293b', hole: '#f8fafc', grass: '#38bdf8' }),
  board('board_crimson', 'EPIC', 1500, { frame: '#7f1d1d', frame2: '#450a0a', cell: '#b91c1c', cell2: '#991b1b', line: '#fecaca', numeral: '#fff7ed', hole: '#fef2f2', grass: '#ef4444' }),
  board('board_persia', 'LEGENDARY', 2400, { frame: '#115e59', frame2: '#042f2e', cell: '#14b8a6', cell2: '#0d9488', line: '#99f6e4', numeral: '#fefce8', hole: '#f0fdfa', grass: '#fbbf24' }), // Persian tilework

  /* ---------- AVATARS (procedural pixel faces) ---------- */
  avatar('avatar_seedling', 'COMMON', 0, 1111, ['#84cc16', '#365314', '#ecfccb']),
  avatar('avatar_owl', 'COMMON', 150, 2222, ['#a16207', '#422006', '#fef3c7']),
  avatar('avatar_fennec', 'COMMON', 150, 3333, ['#f97316', '#7c2d12', '#ffedd5']),
  avatar('avatar_lotus', 'RARE', 480, 4444, ['#f472b6', '#831843', '#fce7f3']),
  avatar('avatar_simo', 'RARE', 500, 5555, ['#14b8a6', '#134e4a', '#ccfbf1']),
  avatar('avatar_shir', 'RARE', 520, 6666, ['#eab308', '#713f12', '#fef9c3']),
  avatar('avatar_bot', 'EPIC', 1300, 7777, ['#a3a3a3', '#171717', '#5eead4']),
  avatar('avatar_moon', 'EPIC', 1400, 8888, ['#c084fc', '#3b0764', '#f3e8ff']),
  avatar('avatar_homa', 'RARE', 550, 12121, ['#f59e0b', '#7c2d12', '#fef3c7']), // mythical homa bird
  avatar('avatar_dragon', 'LEGENDARY', 3600, 9999, ['#ef4444', '#450a0a', '#fbbf24']),

  /* ---------- BACKGROUNDS ---------- */
  bg('bg_royal_velvet', 'COMMON', 0, 'velvet', ['#0f0524', '#1e1145', '#2a1a5e'], '#d4af37'),
  bg('bg_starfield', 'RARE', 650, 'stars', ['#020617', '#0f172a', '#1e293b'], '#fbbf24'),
  bg('bg_pixel_city', 'RARE', 700, 'city', ['#1a0b2e', '#2d1b4e', '#443266'], '#f472b6'),
  bg('bg_dunes', 'EPIC', 1400, 'dunes', ['#431407', '#7c2d12', '#b45309'], '#fcd34d'),
  bg('bg_emerald', 'EPIC', 1400, 'stars', ['#022c22', '#064e3b', '#065f46'], '#34d399'),
  bg('bg_aurora', 'EPIC', 1500, 'stars', ['#042f2e', '#134e4a', '#115e59'], '#5eead4'),

  /* ---------- EFFECTS (win celebrations) ---------- */
  fx('fx_confetti', 'COMMON', 0, ['#fbbf24', '#f472b6', '#34d399', '#c084fc'], 'confetti'),
  fx('fx_gold', 'RARE', 550, ['#fcd34d', '#f59e0b', '#fffbeb'], 'coins'),
  fx('fx_pixels', 'RARE', 550, ['#5eead4', '#e879f9', '#fde047'], 'pixels'),
  fx('fx_galaxy', 'EPIC', 1800, ['#c084fc', '#5eead4', '#f0abfc', '#fde047'], 'pixels'),
  fx('fx_phoenix', 'LEGENDARY', 3200, ['#f97316', '#ef4444', '#fbbf24'], 'phoenix'),

  /* ---------- TITLES ---------- */
  title('title_thinker', 'COMMON', 300, 1),
  title('title_quad', 'RARE', 800, 3),
  title('title_star', 'RARE', 700, 4),
  title('title_mathematician', 'EPIC', 1800, 5),
  title('title_legend', 'LEGENDARY', 4000, 8),

  /* ================= v0.1.0-alpha: full-market expansion ================= */
  /* ---------- PIECES ---------- */
  piece('piece_gol', 'COMMON', 160, ['#fda4af', '#9f1239', '#fecdd3'], ['#fdba74', '#9a3412', '#ffedd5'], 41411),
  piece('piece_zafran', 'RARE', 700, ['#f59e0b', '#b45309', '#fef3c7'], ['#22d3ee', '#155e75', '#cffafe'], 52571, '#f59e0b'), // saffron
  piece('piece_lapis', 'EPIC', 1500, ['#60a5fa', '#1e3a8a', '#bfdbfe'], ['#fcd34d', '#92400e', '#fef9c3'], 63591, '#60a5fa'), // lapis lazuli
  piece('piece_perspolis', 'LEGENDARY', 2800, ['#fbbf24', '#78350f', '#fef3c7'], ['#38bdf8', '#075985', '#e0f2fe'], 74615, '#fbbf24'),
  piece('piece_orbit', 'EPIC', 1600, ['#2dd4bf', '#134e4a', '#99f6e4'], ['#fbbf24', '#78350f', '#fde68a'], 85717, '#2dd4bf'),
  piece('piece_quasar', 'ULTIMATE', 7500, ['#f43f5e', '#4c0519', '#fecdd3'], ['#fde047', '#713f12', '#fef9c3'], 96419, '#f43f5e'),

  /* ---------- BOARDS ---------- */
  board('board_mosaic', 'RARE', 780, { frame: '#155e75', frame2: '#083344', cell: '#06b6d4', cell2: '#0891b2', line: '#a5f3fc', numeral: '#ecfeff', hole: '#ecfeff', grass: '#fbbf24' }), // Persian mosaic
  board('board_bazaar', 'EPIC', 1550, { frame: '#7c2d12', frame2: '#431407', cell: '#ea580c', cell2: '#c2410c', line: '#fed7aa', numeral: '#fff7ed', hole: '#fff7ed', grass: '#fbbf24' }),
  board('board_nebula', 'ULTIMATE', 7800, { frame: '#0c0a1d', frame2: '#050510', cell: '#1e1b4b', cell2: '#171335', line: '#e879f9', numeral: '#fde047', hole: '#020617', grass: '#c084fc' }),

  /* ---------- AVATARS ---------- */
  avatar('avatar_golabi', 'COMMON', 140, 13131, ['#fb7185', '#881337', '#ffe4e6']), // pear blossom
  avatar('avatar_kepler', 'RARE', 600, 14141, ['#818cf8', '#312e81', '#e0e7ff']), // the astronomer
  avatar('avatar_neutron', 'EPIC', 1500, 15151, ['#22d3ee', '#164e63', '#cffafe']),
  avatar('avatar_galaxy', 'LEGENDARY', 3800, 16161, ['#a855f7', '#3b0764', '#f5d0fe']),
  avatar('avatar_simorgh', 'ULTIMATE', 7200, 17171, ['#f43f5e', '#4c0519', '#fde047']), // the mythical Simorgh

  /* ---------- BACKGROUNDS ---------- */
  bg('bg_caravan', 'RARE', 720, 'dunes', ['#292524', '#44403c', '#57534e'], '#fbbf24'), // caravan night
  bg('bg_orbit', 'EPIC', 1600, 'stars', ['#082f49', '#0c4a6e', '#0c2340'], '#fbbf24'),
  bg('bg_synapse', 'EPIC', 1500, 'stars', ['#2e1065', '#4c1d95', '#1e1b4b'], '#22d3ee'),
  bg('bg_forge', 'EPIC', 1500, 'dunes', ['#450a0a', '#7c2d12', '#9a3412'], '#f97316'),
  bg('bg_eastern_dawn', 'ULTIMATE', 8000, 'velvet', ['#1a0505', '#3b0a0a', '#5c1010'], '#fbbf24'),

  /* ---------- EFFECTS ---------- */
  fx('fx_supernova', 'LEGENDARY', 3400, ['#f97316', '#fde047', '#ef4444', '#fbbf24'], 'pixels'),
  fx('fx_warp', 'ULTIMATE', 7000, ['#f43f5e', '#22d3ee', '#fde047', '#c084fc'], 'phoenix'),

  /* ---------- TITLES ---------- */
  title('title_navigator', 'RARE', 750, 4),
  title('title_mind', 'EPIC', 1900, 5),
  title('title_keeper', 'LEGENDARY', 4200, 9),
  title('title_supernova', 'ULTIMATE', 7500, 10),
  /* ---------- v0.2 unique drops ---------- */
  piece('piece_ivory', 'RARE', 560, ['#fde8c8', '#b98a4e', '#fff7ea'], ['#065f46', '#022c22', '#a7f3d0'], 61141),
  piece('piece_toormaloo', 'EPIC', 1650, ['#f43f5e', '#881337', '#fecdd3'], ['#2dd4bf', '#0f766e', '#ccfbf1'], 63123, '#f43f5e'),
  piece('piece_celestial', 'ULTIMATE', 6800, ['#fde68a', '#7c2d12', '#f0abfc'], ['#1e1b4b', '#312e81', '#c7d2fe'], 64001, '#fde68a'),
  board('board_orchard', 'RARE', 740, { frame: '#166534', frame2: '#052e16', cell: '#84cc16', cell2: '#65a30d', line: '#ecfccb', numeral: '#1a2e05', hole: '#f7fee7', grass: '#a3e635' }),
  board('board_lagoon', 'EPIC', 1550, { frame: '#0e7490', frame2: '#083344', cell: '#22d3ee', cell2: '#06b6d4', line: '#cffafe', numeral: '#083344', hole: '#ecfeff', grass: '#67e8f9' }),
  board('board_mirage', 'LEGENDARY', 2600, { frame: '#713f12', frame2: '#1c1917', cell: '#d97706', cell2: '#b45309', line: '#fef3c7', numeral: '#fffbeb', hole: '#fefce8', grass: '#f59e0b' }),
  avatar('avatar_bolbol', 'RARE', 560, 13131, ['#fb7185', '#881337', '#ffe4e6']),
  avatar('avatar_kavir', 'EPIC', 1420, 14141, ['#f59e0b', '#451a03', '#fef3c7']),
  avatar('avatar_pardis', 'LEGENDARY', 3400, 15151, ['#34d399', '#064e3b', '#fef9c3']),
  bg('bg_sahra', 'RARE', 800, 'dunes', ['#78350f', '#b45309', '#fbbf24'], '#fde68a'),
  bg('bg_mahtab', 'EPIC', 1500, 'stars', ['#1e1b4b', '#3730a3', '#c7d2fe'], '#a5b4fc'),
  bg('bg_shabestan', 'LEGENDARY', 2900, 'velvet', ['#0c0a1d', '#2e1065', '#7c3aed'], '#c4b5fd'),
  fx('fx_petals', 'EPIC', 1650, ['#fda4af', '#f472b6', '#fecdd3'], 'petals'),
  title('title_architect', 'RARE', 700, 5),
  title('title_logician', 'EPIC', 1600, 8),
  title('title_paradox', 'LEGENDARY', 3200, 12),

  /* ================= v0.3: massive catalog expansion (Task C1) ================= */

  /* ---------- PIECES +6 (Persian & science themes) ---------- */
  piece('piece_turquoise', 'COMMON', 150, ['#2dd4bf', '#0f766e', '#ccfbf1'], ['#d97706', '#78350f', '#fde68a'], 18271), // turquoise-inlaid vs gold
  piece('piece_gaz', 'COMMON', 160, ['#a3e635', '#3f6212', '#ecfccb'], ['#f472b6', '#9d174d', '#fce7f3'], 47391), // Isfahan gaz: pistachio vs rose
  piece('piece_manuscript', 'RARE', 620, ['#fde8c8', '#92400e', '#fff7ea'], ['#1e293b', '#0f172a', '#94a3b8'], 53617), // parchment vs ink
  piece('piece_khatam', 'RARE', 640, ['#b45309', '#451a03', '#fbbf24'], ['#0f766e', '#042f2e', '#5eead4'], 59407), // khatam marquetry
  piece('piece_nebula', 'EPIC', 1500, ['#c084fc', '#3b0764', '#f5d0fe'], ['#22d3ee', '#155e75', '#cffafe'], 72831, '#c084fc'),
  piece('piece_quanta', 'EPIC', 1750, ['#facc15', '#713f12', '#fef9c3'], ['#38bdf8', '#0c4a6e', '#e0f2fe'], 81943, '#facc15'),

  /* ---------- BOARDS +5 ---------- */
  board('board_shiraz', 'RARE', 720, { frame: '#4c0519', frame2: '#2b0410', cell: '#9f1239', cell2: '#881337', line: '#fda4af', numeral: '#ffe4e6', hole: '#fff1f2', grass: '#fb7185' }), // shiraz-wine
  board('board_desert_night', 'RARE', 760, { frame: '#1c1917', frame2: '#0c0a09', cell: '#292524', cell2: '#1c1917', line: '#fcd34d', numeral: '#fde68a', hole: '#fefce8', grass: '#fbbf24' }), // desert night
  board('board_emerald_garden', 'EPIC', 1500, { frame: '#064e3b', frame2: '#022c22', cell: '#059669', cell2: '#047857', line: '#a7f3d0', numeral: '#ecfdf5', hole: '#f0fdf4', grass: '#4ade80' }), // emerald garden
  board('board_obsidian_neon', 'EPIC', 1600, { frame: '#09090b', frame2: '#000000', cell: '#18181b', cell2: '#0f0f12', line: '#22d3ee', numeral: '#f472b6', hole: '#020617', grass: '#a855f7' }), // obsidian neon
  board('board_sunset_kerman', 'LEGENDARY', 2500, { frame: '#7c2d12', frame2: '#431407', cell: '#ea580c', cell2: '#c2410c', line: '#fed7aa', numeral: '#fff7ed', hole: '#fff7ed', grass: '#fbbf24' }), // sunset kerman

  /* ---------- AVATARS +8 ---------- */
  avatar('avatar_athens', 'COMMON', 160, 20111, ['#fbbf24', '#78350f', '#fef9c3']), // owl of Athens
  avatar('avatar_khayyam', 'RARE', 620, 21212, ['#38bdf8', '#0c4a6e', '#e0f2fe']), // the astronomer-poet
  avatar('avatar_calligrapher', 'RARE', 600, 25616, ['#d6d3d1', '#1c1917', '#f5f5f4']), // ink & reed pen
  avatar('avatar_astronaut', 'RARE', 640, 22313, ['#e2e8f0', '#1e293b', '#f8fafc']),
  avatar('avatar_chemist', 'EPIC', 1450, 23414, ['#4ade80', '#14532d', '#d9f99d']),
  avatar('avatar_geometer', 'EPIC', 1500, 24515, ['#818cf8', '#312e81', '#e0e7ff']),
  avatar('avatar_robot', 'EPIC', 1400, 26717, ['#94a3b8', '#0f172a', '#22d3ee']),
  avatar('avatar_phoenix', 'LEGENDARY', 3300, 27818, ['#f97316', '#7c2d12', '#fde047']),

  /* ---------- BACKGROUNDS +5 ---------- */
  bg('bg_royal_blue_day', 'COMMON', 140, 'velvet', ['#172554', '#1e3a8a', '#2563eb'], '#93c5fd'),
  bg('bg_mehregan', 'RARE', 780, 'dunes', ['#7c2d12', '#b45309', '#ea580c'], '#fdba74'), // autumn festival
  bg('bg_zayandeh', 'EPIC', 1450, 'stars', ['#164e63', '#0e7490', '#155e75'], '#67e8f9'), // river reflections
  bg('bg_alborz', 'EPIC', 1500, 'velvet', ['#e2e8f0', '#94a3b8', '#64748b'], '#f8fafc'), // snow peaks
  bg('bg_lanterns', 'LEGENDARY', 2800, 'city', ['#1c0a00', '#451a03', '#7c2d12'], '#fbbf24'), // bazaar lantern night

  /* ---------- EFFECTS +6 ---------- */
  fx('fx_meteor', 'RARE', 600, ['#f97316', '#ef4444', '#fde047'], 'pixels'), // meteor rain
  fx('fx_golddust', 'RARE', 650, ['#fcd34d', '#f59e0b', '#fffbeb'], 'coins'), // gold dust
  fx('fx_starburst', 'EPIC', 1500, ['#fde047', '#fbbf24', '#ffffff'], 'pixels'),
  fx('fx_prism', 'EPIC', 1600, ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6'], 'confetti'),
  fx('fx_ember', 'EPIC', 1700, ['#f97316', '#b91c1c', '#fbbf24'], 'phoenix'), // ember storm
  fx('fx_blossom', 'LEGENDARY', 2600, ['#fda4af', '#f472b6', '#fecdd3', '#fbbf24'], 'petals'),

  /* ---------- TITLES +10 ---------- */
  title('title_sage', 'RARE', 700, 4),
  title('title_poet', 'RARE', 750, 5),
  title('title_vizier', 'EPIC', 1500, 6),
  title('title_astronomer', 'EPIC', 1600, 6),
  title('title_alchemist', 'EPIC', 1700, 7),
  title('title_oracle', 'EPIC', 1800, 8),
  title('title_sultan', 'LEGENDARY', 2400, 9),
  title('title_grandmaster', 'LEGENDARY', 2600, 10),
  title('title_immortal', 'LEGENDARY', 3000, 11),
  title('title_cosmos', 'ULTIMATE', 6000, 12),

  /* ---------- EMOTE PACKS +6 (functional: swap the in-duel emote bar) ---------- */
  { code: 'emote_farmer', category: 'EMOTE', rarity: 'COMMON', price: 240, requiredLevel: 1, data: { emotes: [
    { id: 'harvest', emoji: '🌾' }, { id: 'tractor', emoji: '🚜' }, { id: 'moo', emoji: '🐄' }, { id: 'tomato', emoji: '🍅' }, { id: 'basket', emoji: '🧺' },
  ] } },
  { code: 'emote_chess', category: 'EMOTE', rarity: 'RARE', price: 640, requiredLevel: 3, data: { emotes: [
    { id: 'pawn', emoji: '♟️' }, { id: 'rook', emoji: '♜' }, { id: 'knight', emoji: '♞' }, { id: 'queen', emoji: '♛' }, { id: 'clock', emoji: '⏳' },
  ] } },
  { code: 'emote_poets', category: 'EMOTE', rarity: 'RARE', price: 720, requiredLevel: 4, data: { emotes: [
    { id: 'ink', emoji: '🖋️' }, { id: 'moon', emoji: '🌙' }, { id: 'wine', emoji: '🍷' }, { id: 'dove', emoji: '🕊️' }, { id: 'book', emoji: '📖' },
  ] } },
  { code: 'emote_lab', category: 'EMOTE', rarity: 'EPIC', price: 1450, requiredLevel: 6, data: { emotes: [
    { id: 'flask', emoji: '🧪' }, { id: 'scope', emoji: '🔬' }, { id: 'alembic', emoji: '⚗️' }, { id: 'dna', emoji: '🧬' }, { id: 'zap', emoji: '⚡' },
  ] } },
  { code: 'emote_bazaar', category: 'EMOTE', rarity: 'EPIC', price: 1550, requiredLevel: 7, data: { emotes: [
    { id: 'bag', emoji: '🛍️' }, { id: 'charm', emoji: '🧿' }, { id: 'tea', emoji: '🍵' }, { id: 'drum', emoji: '🪘' }, { id: 'gems', emoji: '💎' },
  ] } },
  { code: 'emote_navigator', category: 'EMOTE', rarity: 'LEGENDARY', price: 2900, requiredLevel: 9, data: { emotes: [
    { id: 'compass', emoji: '🧭' }, { id: 'sail', emoji: '⛵' }, { id: 'map', emoji: '🗺️' }, { id: 'wave', emoji: '🌊' }, { id: 'isle', emoji: '🏝️' },
  ] } },

  /* ---------- CELEBRATION PACKS +10 (funny dancing characters on victory;
   *             graphics quality scales with rarity — see CelebrationSprite) ---------- */
  { code: 'celeb_confetti', category: 'CELEBRATION', rarity: 'COMMON', price: 0, requiredLevel: 1, data: { character: 'blob' } }, // «کانفتی خوشحال» Confetti Buddy
  { code: 'celeb_robo', category: 'CELEBRATION', rarity: 'COMMON', price: 200, requiredLevel: 1, data: { character: 'robot' } }, // «ربات راکتی» Robo Rave
  { code: 'celeb_pigeon', category: 'CELEBRATION', rarity: 'RARE', price: 450, requiredLevel: 1, data: { character: 'pigeon' } }, // «کبوتر بریک» Breakdance Pigeon
  { code: 'celeb_camel', category: 'CELEBRATION', rarity: 'RARE', price: 600, requiredLevel: 1, data: { character: 'camel' } }, // «شتر دیسکو» Disco Camel
  { code: 'celeb_mummy', category: 'CELEBRATION', rarity: 'EPIC', price: 1200, requiredLevel: 3, data: { character: 'mummy' } }, // «مومیایی گام‌بلند» Moonwalk Mummy
  { code: 'celeb_cactus', category: 'CELEBRATION', rarity: 'EPIC', price: 1500, requiredLevel: 3, data: { character: 'cactus' } }, // «کاکتوس سالسا» Salsa Cactus
  { code: 'celeb_rocket', category: 'CELEBRATION', rarity: 'LEGENDARY', price: 2600, requiredLevel: 6, data: { character: 'rocket' } }, // «موشک باله» Ballet Rocket
  { code: 'celeb_jelly', category: 'CELEBRATION', rarity: 'LEGENDARY', price: 3000, requiredLevel: 6, data: { character: 'jelly' } }, // «عروس دریایی نئون» Neon Jellyfish
  { code: 'celeb_dragon', category: 'CELEBRATION', rarity: 'ULTIMATE', price: 6000, requiredLevel: 12, data: { character: 'dragon' } }, // «اژدهای تیلت‌پرون» Twerk Dragon
  { code: 'celeb_phoenix', category: 'CELEBRATION', rarity: 'ULTIMATE', price: 7500, requiredLevel: 12, data: { character: 'phoenix' } }, // «ققنوس جشن» Festival Phoenix

  /* ---------- CHEESY PURSUIT characters (task R12-a) ----------
   * Single source of truth: src/lib/game/cheese-data.ts CHARACTERS.
   * NOTE: the platform StoreView keeps an exhaustive Record<ItemCategory,
   * EquipField> + a fixed tab list, so the characters ride the AVATAR tab
   * (they are equippable avatars too) — the data JSON carries everything the
   * in-game Character Shop needs (species/palette/perk/hat) plus seed+pal so
   * the standard pixel-avatar preview renders them without any StoreView
   * changes. The shop itself filters by the `char_` code prefix.
   */
  ...CHARACTERS.map((c) => ({
    code: c.code,
    category: 'AVATAR' as ItemCategory,
    rarity: c.rarity,
    price: c.price,
    requiredLevel: c.reqLevel,
    data: {
      species: c.species,
      palette: c.palette,
      perk: c.perk,
      hat: c.hat,
      hatColor: c.hatColor,
      /* seed+pal keep the shared pixel-avatar preview renderer happy */
      seed: [...c.code].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7) >>> 0,
      pal: [c.palette.fur, c.palette.accent, c.palette.belly],
    },
  })),

];

/**
 * Premium display names for items whose prettyName() reading is too plain
 * (celebration packs / titles). OPTIONAL + safe: consumers fall back to
 * prettyName(code) when a code is absent. ar/tr locales fall back to en.
 */
export const ITEM_NAMES: Record<string, { fa: string; en: string }> = {
  // celebration packs
  celeb_confetti: { fa: 'کانفتی خوشحال', en: 'Confetti Buddy' },
  celeb_robo: { fa: 'ربات راکتی', en: 'Robo Rave' },
  celeb_pigeon: { fa: 'کبوتر بریک', en: 'Breakdance Pigeon' },
  celeb_camel: { fa: 'شتر دیسکو', en: 'Disco Camel' },
  celeb_mummy: { fa: 'مومیایی گام‌بلند', en: 'Moonwalk Mummy' },
  celeb_cactus: { fa: 'کاکتوس سالسا', en: 'Salsa Cactus' },
  celeb_rocket: { fa: 'موشک باله', en: 'Ballet Rocket' },
  celeb_jelly: { fa: 'عروس دریایی نئون', en: 'Neon Jellyfish' },
  celeb_dragon: { fa: 'اژدهای تیلت‌پرون', en: 'Twerk Dragon' },
  celeb_phoenix: { fa: 'ققنوس جشن', en: 'Festival Phoenix' },
  // new titles
  title_sage: { fa: 'حکیم', en: 'Sage' },
  title_poet: { fa: 'شاعر', en: 'Poet' },
  title_vizier: { fa: 'وزیر', en: 'Vizier' },
  title_astronomer: { fa: 'ستاره‌شناس', en: 'Astronomer' },
  title_alchemist: { fa: 'کیمیاگر', en: 'Alchemist' },
  title_oracle: { fa: 'پیشگو', en: 'Oracle' },
  title_sultan: { fa: 'سلطان', en: 'Sultan' },
  title_grandmaster: { fa: 'استاد بزرگ', en: 'Grandmaster' },
  title_immortal: { fa: 'جاودانه', en: 'Immortal' },
  title_cosmos: { fa: 'آفاق', en: 'Cosmos' },
  // Cheesy Pursuit characters (task R12-a)
  ...Object.fromEntries(CHARACTERS.map((c) => [c.code, { fa: c.names.fa, en: c.names.en }])),
};

/* ================= ACHIEVEMENTS ================= */
export type AchEvent =
  | 'game_end' | 'move' | 'purchase' | 'quest' | 'level' | 'online';

export interface AchievementDef {
  id: string;
  icon: string; // lucide icon name
  rarity: Rarity;
  goal: number;
  /** which counter to track */
  metric:
    | 'wins' | 'kindWins' | 'runWins' | 'games' | 'onlineWins' | 'onlineGames'
    | 'hardWins' | 'streakBest' | 'itemsOwned' | 'level' | 'questsDone' | 'draws'
    | 'arcadeGames' | 'boxOpens';
  coins: number; // reward coins on unlock
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', icon: 'Sparkles', rarity: 'COMMON', goal: 1, metric: 'wins', coins: 50 },
  { id: 'kind_1', icon: 'Grid2x2', rarity: 'COMMON', goal: 1, metric: 'kindWins', coins: 60 },
  { id: 'run_1', icon: 'TrendingUp', rarity: 'COMMON', goal: 1, metric: 'runWins', coins: 60 },
  { id: 'games_10', icon: 'Gamepad2', rarity: 'COMMON', goal: 10, metric: 'games', coins: 80 },
  { id: 'online_1', icon: 'Globe', rarity: 'COMMON', goal: 1, metric: 'onlineWins', coins: 70 },
  { id: 'quests_5', icon: 'ScrollText', rarity: 'COMMON', goal: 5, metric: 'questsDone', coins: 90 },
  { id: 'draw_1', icon: 'Scale', rarity: 'COMMON', goal: 1, metric: 'draws', coins: 40 },
  { id: 'streak_3', icon: 'Flame', rarity: 'RARE', goal: 3, metric: 'streakBest', coins: 150 },
  { id: 'hard_1', icon: 'Skull', rarity: 'RARE', goal: 1, metric: 'hardWins', coins: 160 },
  { id: 'games_50', icon: 'Trophy', rarity: 'RARE', goal: 50, metric: 'games', coins: 200 },
  { id: 'collector', icon: 'ShoppingBag', rarity: 'RARE', goal: 5, metric: 'itemsOwned', coins: 180 },
  { id: 'online_10', icon: 'Wifi', rarity: 'RARE', goal: 10, metric: 'onlineWins', coins: 220 },
  { id: 'kind_5', icon: 'Layers', rarity: 'EPIC', goal: 5, metric: 'kindWins', coins: 350 },
  { id: 'run_5', icon: 'Rocket', rarity: 'EPIC', goal: 5, metric: 'runWins', coins: 350 },
  { id: 'streak_7', icon: 'Zap', rarity: 'EPIC', goal: 7, metric: 'streakBest', coins: 400 },
  { id: 'level_10', icon: 'Star', rarity: 'EPIC', goal: 10, metric: 'level', coins: 300 },
  { id: 'games_100', icon: 'Crown', rarity: 'LEGENDARY', goal: 100, metric: 'games', coins: 700 },
  { id: 'streak_15', icon: 'Meteor', rarity: 'LEGENDARY', goal: 15, metric: 'streakBest', coins: 900 },
  { id: 'level_20', icon: 'Gem', rarity: 'LEGENDARY', goal: 20, metric: 'level', coins: 1000 },
  /* v0.1.0-alpha: arcade + market */
  { id: 'arcade_1', icon: 'Rocket', rarity: 'COMMON', goal: 1, metric: 'arcadeGames', coins: 60 },
  { id: 'arcade_10', icon: 'Orbit', rarity: 'RARE', goal: 10, metric: 'arcadeGames', coins: 200 },
  { id: 'arcade_30', icon: 'BrainCircuit', rarity: 'EPIC', goal: 30, metric: 'arcadeGames', coins: 420 },
  { id: 'box_1', icon: 'PackageOpen', rarity: 'COMMON', goal: 1, metric: 'boxOpens', coins: 50 },
  { id: 'box_10', icon: 'Gift', rarity: 'RARE', goal: 10, metric: 'boxOpens', coins: 190 },
];

/* ================= DAILY QUESTS ================= */
export interface QuestDef {
  id: string;
  metric: 'games' | 'wins' | 'kindWin' | 'runWin' | 'moves' | 'onlineGames' | 'pveWins' | 'hardWin' | 'drawGame' | 'localGames' | 'arcadeGames';
  goal: number;
  reward: number;
}

export const QUEST_POOL: QuestDef[] = [
  { id: 'q_play3', metric: 'games', goal: 3, reward: 40 },
  { id: 'q_win2', metric: 'wins', goal: 2, reward: 70 },
  { id: 'q_kind', metric: 'kindWin', goal: 1, reward: 60 },
  { id: 'q_run', metric: 'runWin', goal: 1, reward: 80 },
  { id: 'q_moves25', metric: 'moves', goal: 25, reward: 35 },
  { id: 'q_online1', metric: 'onlineGames', goal: 1, reward: 45 },
  { id: 'q_pve1', metric: 'pveWins', goal: 1, reward: 50 },
  { id: 'q_win4', metric: 'wins', goal: 4, reward: 130 },
  { id: 'q_moves50', metric: 'moves', goal: 50, reward: 60 },
  { id: 'q_pve3', metric: 'pveWins', goal: 3, reward: 110 },
  { id: 'q_hard1', metric: 'hardWin', goal: 1, reward: 90 },
  { id: 'q_draw1', metric: 'drawGame', goal: 1, reward: 65 },
  { id: 'q_local2', metric: 'localGames', goal: 2, reward: 40 },
  { id: 'q_online2', metric: 'onlineGames', goal: 2, reward: 95 },
  /* v0.1.0-alpha: arcade quests */
  { id: 'q_arcade1', metric: 'arcadeGames', goal: 1, reward: 45 },
  { id: 'q_arcade3', metric: 'arcadeGames', goal: 3, reward: 105 },
];

/** Deterministically pick 3 quests per user per day (seeded by dateKey+userId). */
export function questsForDay(dateKey: string, userId: string): QuestDef[] {
  let seed = 2166136261;
  const str = dateKey + '|' + userId;
  for (let i = 0; i < str.length; i++) {
    seed ^= str.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const rnd = (() => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const pool = [...QUEST_POOL];
  const picked: QuestDef[] = [];
  while (picked.length < 3 && pool.length) {
    picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return picked;
}

/* ================= ECONOMY ================= */
export function xpForLevel(level: number): number {
  // XP needed to advance FROM `level` to level+1
  return 100 + (level - 1) * 60;
}

export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level) && level < 99) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, into: remaining, need: xpForLevel(level) };
}

export interface RewardInput {
  mode: 'PVE' | 'LOCAL_PVP' | 'ONLINE';
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  aiLevel?: 'EASY' | 'MEDIUM' | 'HARD';
  ranked?: boolean;
  moves: number;
  streak: number; // current streak BEFORE this game (for win bonus)
}

export function computeRewards(r: RewardInput): { coins: number; xp: number } {
  let coins = 0;
  let xp = 0;
  if (r.mode === 'ONLINE') {
    if (r.outcome === 'WIN') { coins = 60 + Math.min(r.streak, 5) * 6; xp = 80; }
    else if (r.outcome === 'DRAW') { coins = 28; xp = 40; }
    else { coins = 12; xp = 20; }
  } else if (r.mode === 'PVE') {
    const base = r.aiLevel === 'HARD' ? 45 : r.aiLevel === 'MEDIUM' ? 22 : 8;
    if (r.outcome === 'WIN') { coins = base; xp = 30 + (r.aiLevel === 'HARD' ? 30 : r.aiLevel === 'MEDIUM' ? 12 : 0); }
    else if (r.outcome === 'DRAW') { coins = Math.ceil(base / 3); xp = 15; }
    else { coins = Math.ceil(base / 5); xp = 8; }
  } else { // LOCAL_PVP — fun + XP only (anti-farm: near-zero coins)
    coins = 4; xp = 25;
  }
  return { coins, xp };
}

/** ELO with K=32; returns deltas from p1 perspective */
export function eloDeltas(r1: number, r2: number, p1Score: 0 | 0.5 | 1, k = 32): [number, number] {
  const exp = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
  const d = Math.round(k * (p1Score - exp));
  return [d, -d];
}

/* ================= v0.1.0-alpha: LOOT BOXES ================= */
export type DropKind = 'COINS' | 'XP' | 'ITEM';
export interface DropDef { kind: DropKind; itemCode?: string; amount: number; weight: number; }
export interface LootBoxDefT { code: string; rarity: Rarity; price: number; image: string; drops: DropDef[]; }

/** Source of truth for the five chests — synced to DB by src/scripts/sync-items.ts */
export const LOOT_BOXES: LootBoxDefT[] = [
  {
    code: 'box_common', rarity: 'COMMON', price: 300, image: '/art/box-common.png',
    drops: [
      { kind: 'COINS', amount: 80, weight: 30 },
      { kind: 'COINS', amount: 150, weight: 22 },
      { kind: 'COINS', amount: 260, weight: 10 },
      { kind: 'XP', amount: 60, weight: 14 },
      { kind: 'XP', amount: 120, weight: 6 },
      { kind: 'ITEM', itemCode: 'piece_gol', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'avatar_golabi', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'bg_caravan', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'piece_zafran', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'board_mosaic', amount: 0, weight: 2 },
    ],
  },
  {
    code: 'box_rare', rarity: 'RARE', price: 800, image: '/art/box-rare.png',
    drops: [
      { kind: 'COINS', amount: 200, weight: 24 },
      { kind: 'COINS', amount: 420, weight: 14 },
      { kind: 'COINS', amount: 700, weight: 6 },
      { kind: 'XP', amount: 150, weight: 14 },
      { kind: 'XP', amount: 300, weight: 6 },
      { kind: 'ITEM', itemCode: 'piece_zafran', amount: 0, weight: 6 },
      { kind: 'ITEM', itemCode: 'board_mosaic', amount: 0, weight: 5 },
      { kind: 'ITEM', itemCode: 'avatar_kepler', amount: 0, weight: 5 },
      { kind: 'ITEM', itemCode: 'title_navigator', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'piece_lapis', amount: 0, weight: 3 },
      { kind: 'ITEM', itemCode: 'fx_supernova', amount: 0, weight: 1 },
    ],
  },
  {
    code: 'box_epic', rarity: 'EPIC', price: 1800, image: '/art/box-epic.png',
    drops: [
      { kind: 'COINS', amount: 500, weight: 22 },
      { kind: 'COINS', amount: 1000, weight: 10 },
      { kind: 'XP', amount: 350, weight: 14 },
      { kind: 'ITEM', itemCode: 'piece_lapis', amount: 0, weight: 8 },
      { kind: 'ITEM', itemCode: 'piece_orbit', amount: 0, weight: 7 },
      { kind: 'ITEM', itemCode: 'avatar_neutron', amount: 0, weight: 7 },
      { kind: 'ITEM', itemCode: 'bg_synapse', amount: 0, weight: 6 },
      { kind: 'ITEM', itemCode: 'board_bazaar', amount: 0, weight: 6 },
      { kind: 'ITEM', itemCode: 'title_mind', amount: 0, weight: 4 },
      { kind: 'ITEM', itemCode: 'piece_perspolis', amount: 0, weight: 3 },
      { kind: 'ITEM', itemCode: 'fx_supernova', amount: 0, weight: 2 },
    ],
  },
  {
    code: 'box_legendary', rarity: 'LEGENDARY', price: 3600, image: '/art/box-legendary.png',
    drops: [
      { kind: 'COINS', amount: 1200, weight: 20 },
      { kind: 'COINS', amount: 2200, weight: 8 },
      { kind: 'XP', amount: 700, weight: 12 },
      { kind: 'ITEM', itemCode: 'piece_perspolis', amount: 0, weight: 9 },
      { kind: 'ITEM', itemCode: 'avatar_galaxy', amount: 0, weight: 9 },
      { kind: 'ITEM', itemCode: 'bg_forge', amount: 0, weight: 7 },
      { kind: 'ITEM', itemCode: 'title_keeper', amount: 0, weight: 5 },
      { kind: 'ITEM', itemCode: 'fx_supernova', amount: 0, weight: 6 },
      { kind: 'ITEM', itemCode: 'piece_quasar', amount: 0, weight: 2 },
      { kind: 'ITEM', itemCode: 'fx_warp', amount: 0, weight: 1 },
    ],
  },
  {
    code: 'box_ultimate', rarity: 'ULTIMATE', price: 7200, image: '/art/box-ultimate.png',
    drops: [
      { kind: 'COINS', amount: 3000, weight: 18 },
      { kind: 'COINS', amount: 5500, weight: 7 },
      { kind: 'XP', amount: 1500, weight: 10 },
      { kind: 'ITEM', itemCode: 'piece_quasar', amount: 0, weight: 10 },
      { kind: 'ITEM', itemCode: 'avatar_simorgh', amount: 0, weight: 10 },
      { kind: 'ITEM', itemCode: 'bg_eastern_dawn', amount: 0, weight: 9 },
      { kind: 'ITEM', itemCode: 'board_nebula', amount: 0, weight: 9 },
      { kind: 'ITEM', itemCode: 'fx_warp', amount: 0, weight: 6 },
      { kind: 'ITEM', itemCode: 'title_supernova', amount: 0, weight: 6 },
    ],
  },

];

/** Weighted random pick (server-side). Returns the winning drop. */
export function rollDrop(drops: DropDef[], rnd: () => number = Math.random): DropDef {
  const total = drops.reduce((s, d) => s + d.weight, 0);
  let r = rnd() * total;
  for (const d of drops) {
    r -= d.weight;
    if (r <= 0) return d;
  }
  return drops[drops.length - 1];
}

/* ================= v0.1.0-alpha: ARCADE ECONOMY ================= */
export type ArcadeGame = 'orbit' | 'synapse' | 'stellar' | 'mazemind' | 'boulderyard' | 'boulderyard2' | 'cheese';
export const ARCADE_GAMES: ArcadeGame[] = ['orbit', 'synapse', 'stellar', 'mazemind', 'boulderyard', 'boulderyard2', 'cheese'];

/** Per-game hourly coin caps (anti-farm, mirrors duel CAPS). */
export const ARCADE_CAPS: Record<ArcadeGame, number> = { orbit: 260, synapse: 220, stellar: 240, mazemind: 300, boulderyard: 260, boulderyard2: 280, cheese: 280 };

/**
 * Score -> rewards. Score scales differ per game; each formula is tuned so a
 * solid mid-tier run ≈ a duel win. Server clamps by hourly cap.
 */
export function arcadeRewards(game: ArcadeGame, score: number): { coins: number; xp: number } {
  if (!Number.isFinite(score) || score <= 0) return { coins: 3, xp: 6 };
  const s = Math.floor(score);
  if (game === 'orbit') {
    // perfect mission ≈ 1000; typical early mission ≈ 300
    const coins = Math.min(90, 12 + Math.floor(s / 12));
    const xp = Math.min(120, 20 + Math.floor(s / 9));
    return { coins, xp };
  }
  if (game === 'synapse') {
    // session score ≈ trials × accuracy × n
    const coins = Math.min(80, 10 + Math.floor(s / 14));
    const xp = Math.min(110, 18 + Math.floor(s / 10));
    return { coins, xp };
  }
  // stellar: mass units forged; a full supernova run ≈ 2000+
  const coins = Math.min(85, 10 + Math.floor(s / 24));
  const xp = Math.min(115, 16 + Math.floor(s / 18));
  return { coins, xp };
}

/** v0.2 reward curves for the newer arcade games (mind-tank wave scores,
 *  boulder yard level scores, cheesy pursuit escapes). Same tuning goal:
 *  solid run ≈ a duel win. */
export function arcadeRewardsV2(game: 'mazemind' | 'boulderyard' | 'boulderyard2' | 'cheese', score: number): { coins: number; xp: number } {
  if (!Number.isFinite(score) || score <= 0) return { coins: 3, xp: 6 };
  const s = Math.floor(score);
  if (game === 'mazemind') {
    // a full 10-robot run ≈ 3200; casual early death ≈ 500
    const coins = Math.min(100, 12 + Math.floor(s / 26));
    const xp = Math.min(130, 16 + Math.floor(s / 20));
    return { coins, xp };
  }
  if (game === 'boulderyard') {
    // solving ~6 levels ≈ 1400
    const coins = Math.min(90, 10 + Math.floor(s / 18));
    const xp = Math.min(110, 14 + Math.floor(s / 15));
    return { coins, xp };
  }
  if (game === 'boulderyard2') {
    // boulderyard2: trickier mechanics, slightly richer
    const coins = Math.min(95, 10 + Math.floor(s / 17));
    const xp = Math.min(120, 14 + Math.floor(s / 14));
    return { coins, xp };
  }
  // cheese: a clean late-level escape ≈ 2400; early runs ≈ 500
  const coins = Math.min(95, 10 + Math.floor(s / 16));
  const xp = Math.min(120, 14 + Math.floor(s / 13));
  return { coins, xp };
}

/** Sanity ceiling for client-reported scores (anything above is suspect → clamped). */
export const ARCADE_SCORE_CEIL: Record<ArcadeGame, number> = { orbit: 1400, synapse: 1200, stellar: 4000, mazemind: 6000, boulderyard: 5000, boulderyard2: 6000, cheese: 6000 };


/* ================= v0.2: EMOTE PACKS ================= */
/** id → emoji across ALL packs (receivers resolve any incoming emote id). */
export const ALL_EMOTES: Record<string, string> = Object.fromEntries(
  STORE_ITEMS.filter((i) => i.category === 'EMOTE').flatMap((i) => {
    const emotes = (i.data as { emotes?: { id: string; emoji: string }[] }).emotes ?? [];
    return emotes.map((e) => [e.id, e.emoji]);
  }),
);

/** The five emotes of a pack (falls back to classic). */
export function emotePackList(code: string | undefined): { id: string; emoji: string }[] {
  const item = STORE_ITEMS.find((i) => i.code === (code ?? 'emote_classic') && i.category === 'EMOTE');
  const list = item ? (item.data as { emotes: { id: string; emoji: string }[] }).emotes : [];
  const fallback = STORE_ITEMS.find((i) => i.code === 'emote_classic');
  return list.length > 0 ? list : ((fallback?.data as { emotes: { id: string; emoji: string }[] }).emotes ?? []);
}
