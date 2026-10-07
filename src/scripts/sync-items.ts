/**
 * Idempotent store-item + loot-box sync: upserts every STORE_ITEMS catalog
 * entry and every LOOT_BOXES definition into the DB (prices/rarity/data/
 * sortOrder + drop pools) WITHOUT touching users or purchases.
 * Safe to run whenever new cosmetics / chests are added to content.ts.
 */
import { PrismaClient } from '@prisma/client';
import { STORE_ITEMS, LOOT_BOXES } from '../lib/game/content';

const db = new PrismaClient();

async function main() {
  for (const [i, it] of STORE_ITEMS.entries()) {
    await db.storeItem.upsert({
      where: { code: it.code },
      create: {
        code: it.code, category: it.category, rarity: it.rarity, price: it.price,
        requiredLevel: it.requiredLevel, data: JSON.stringify(it.data), sortOrder: i,
      },
      update: { category: it.category, rarity: it.rarity, price: it.price, requiredLevel: it.requiredLevel, data: JSON.stringify(it.data), sortOrder: i },
    });
  }
  console.log(`synced ${STORE_ITEMS.length} store items`);

  for (const box of LOOT_BOXES) {
    await db.lootBoxDef.upsert({
      where: { code: box.code },
      create: { code: box.code, rarity: box.rarity, price: box.price, image: box.image },
      update: { rarity: box.rarity, price: box.price, image: box.image },
    });
    // rebuild the drop pool only when it is empty (admins may have re-tuned odds)
    const existing = await db.lootBoxDrop.count({ where: { boxCode: box.code } });
    if (existing === 0) {
      await db.lootBoxDrop.createMany({
        data: box.drops.map((d) => ({ boxCode: box.code, kind: d.kind, itemCode: d.itemCode ?? null, amount: d.amount, weight: d.weight })),
      });
    }
    console.log(`synced chest ${box.code} (${existing} existing drops kept)`);
  }

  // default platform flags
  const flags: Record<string, string> = {
    game_orbit_enabled: '1',
    game_synapse_enabled: '1',
    game_stellar_enabled: '1',
    game_mazemind_enabled: '1',
    game_boulderyard_enabled: '1',
    game_boulderyard2_enabled: '1',
    market_enabled: '1',
  };
  for (const [key, value] of Object.entries(flags)) {
    await db.platformConfig.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  console.log('synced platform flags');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
