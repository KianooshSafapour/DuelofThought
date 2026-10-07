import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Public platform config for the client (which games / market are enabled). */
export async function GET() {
  const rows = await db.platformConfig.findMany({
    where: { key: { in: ['game_orbit_enabled', 'game_synapse_enabled', 'game_stellar_enabled', 'game_mazemind_enabled', 'game_boulderyard_enabled', 'game_cheese_enabled', 'market_enabled'] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value === '1']));
  return NextResponse.json({
    games: {
      orbit: map.game_orbit_enabled ?? true,
      synapse: map.game_synapse_enabled ?? true,
      stellar: map.game_stellar_enabled ?? true,
      mazemind: map.game_mazemind_enabled ?? true,
      boulderyard: map.game_boulderyard_enabled ?? true,
      cheese: map.game_cheese_enabled ?? true,
    },
    market: map.market_enabled ?? true,
  });
}
