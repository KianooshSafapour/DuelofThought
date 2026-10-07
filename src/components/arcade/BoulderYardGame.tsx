'use client';

/**
 * Boulder Yard (سنگ‌چین) — unified entry (R12-b merge).
 *
 * ONE game containing BOTH campaigns behind campaign tabs:
 *   • Campaign 1 «BOULDER YARD»   — quarry theme · classic push puzzles
 *   • Campaign 2 «BOULDER YARD II» — factory theme · pits & one-way gates
 * Garage, driver level and money are shared across campaigns
 * (localStorage doi_boulder_garage_v1); this entry boots on campaign 1.
 */
import { BoulderGameCore, type HelpRow, type BoulderCampaignSpec } from '@/components/arcade/boulder-shared';
import { LEVELS as C1_LEVELS } from '@/lib/game/boulder-levels';
import { LEVELS as C2_LEVELS } from '@/lib/game/boulder2-levels';

const HELP1: HelpRow[] = [
  { icon: '🎮', key: 'by_how1' },
  { icon: '🪨', key: 'by_how2' },
  { icon: '🎯', key: 'by_how3' },
];

const HELP2: HelpRow[] = [
  { icon: '🎮', key: 'by_how1' },
  { icon: '🪨', key: 'by_how2' },
  { icon: '🕳️', key: 'by2_how_pit' },
  { icon: '➤', key: 'by2_how_gate' },
];

/** Campaign 1 — quarry (levels keep their original storage key). */
const C1: BoulderCampaignSpec = {
  arcadeId: 'boulderyard',
  storageKey: 'doi_boulder_yard',
  levels: C1_LEVELS,
  yardSize: 8,
  nameKey: 'game_boulderyard',
  tagKey: 'game_boulderyard_tag',
  theme: 'quarry',
  icon: '🪨',
  helpRows: HELP1,
};

/** Campaign 2 — factory, pits & gates (levels keep their original storage key). */
const C2: BoulderCampaignSpec = {
  arcadeId: 'boulderyard2',
  storageKey: 'doi_boulder_yard2',
  levels: C2_LEVELS,
  yardSize: 8,
  nameKey: 'game_boulderyard2',
  tagKey: 'game_boulderyard2_tag',
  theme: 'factory',
  icon: '🕳️',
  helpRows: HELP2,
};

const CAMPAIGNS: BoulderCampaignSpec[] = [C1, C2];

export function BoulderYardGame({ onExit }: { onExit: () => void }) {
  return (
    <BoulderGameCore
      campaigns={CAMPAIGNS}
      initialCampaign={0}
      onExit={onExit}
      bootTitle="BOULDER YARD"
      bootSubtitle="DRIVER CAMPAIGNS · QUARRY & FACTORY"
      bootAccent="#34d399"
      bootIcon="🚜"
    />
  );
}

/**
 * Compat entry: the old second game now boots the unified game with the
 * campaign-2 tab preselected (BoulderYardGame2.tsx re-exports this).
 */
export function BoulderYardGame2({ onExit }: { onExit: () => void }) {
  return (
    <BoulderGameCore
      campaigns={CAMPAIGNS}
      initialCampaign={1}
      onExit={onExit}
      bootTitle="BOULDER YARD II"
      bootSubtitle="DRIVER CAMPAIGNS · QUARRY & FACTORY"
      bootAccent="#a78bfa"
      bootIcon="⛏️"
    />
  );
}
