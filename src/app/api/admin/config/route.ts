import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser, isBanned } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const me = await currentUser();
  if (!me || me.role !== 'ADMIN' || isBanned(me)) return null;
  return me;
}

const ALLOWED_KEYS = ['game_orbit_enabled', 'game_synapse_enabled', 'game_stellar_enabled', 'market_enabled'];

/** GET /api/admin/config — platform feature flags */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const rows = await db.platformConfig.findMany({ where: { key: { in: ALLOWED_KEYS } } });
  return NextResponse.json({ flags: Object.fromEntries(rows.map((r) => [r.key, r.value === '1'])) });
}

const putSchema = z.object({ key: z.string().min(3).max(50), value: z.boolean() });

/** PUT /api/admin/config — toggle a feature flag */
export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const body = putSchema.safeParse(await req.json().catch(() => null));
  if (!body.success || !ALLOWED_KEYS.includes(body.data.key)) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
  await db.platformConfig.upsert({
    where: { key: body.data.key },
    create: { key: body.data.key, value: body.data.value ? '1' : '0' },
    update: { value: body.data.value ? '1' : '0' },
  });
  await db.auditLog.create({ data: { actorId: admin.id, action: 'CONFIG_SET', targetId: body.data.key, details: String(body.data.value) } });
  return NextResponse.json({ ok: true });
}
