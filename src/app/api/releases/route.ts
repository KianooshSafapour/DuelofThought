import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * /api/releases — native build-kit distribution.
 *
 * GET                → { version, files: [{file, platform, label, size}] }
 * GET ?file=<name>   → streams the zip (Content-Disposition: attachment)
 *
 * Files live in <project>/releases/native and are produced by
 * scripts/make-native-packages.py (Electron → Windows/Linux, Capacitor → Android).
 */

const NATIVE_DIR = join(process.cwd(), 'releases', 'native');
const VERSION = 'v0.4.0-alpha';

const LABELS: Record<string, { platform: string; label: string }> = {
  'DuelOfThought-Windows-kit.zip': { platform: 'windows', label: 'Windows · exe (Electron)' },
  'DuelOfThought-Linux-kit.zip': { platform: 'linux', label: 'Linux · AppImage/deb (Electron)' },
  'DuelOfThought-Android-kit.zip': { platform: 'android', label: 'Android · APK (Capacitor)' },
};

function listFiles() {
  try {
    return readdirSync(NATIVE_DIR).filter((f) => f.endsWith('.zip') && LABELS[f]);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get('file');

  if (file) {
    if (!/^[\w.-]+\.zip$/.test(file) || !LABELS[file]) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    try {
      const buf = readFileSync(join(NATIVE_DIR, file));
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${file}"`,
          'Content-Length': String(buf.length),
        },
      });
    } catch {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
  }

  const files = listFiles().map((f) => ({
    file: f,
    ...LABELS[f],
    size: statSync(join(NATIVE_DIR, f)).size,
  }));

  return NextResponse.json(
    { version: VERSION, files },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
