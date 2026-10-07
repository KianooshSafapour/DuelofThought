/**
 * Procedural pixel-art sprite generator.
 * Classic "space invader" symmetric-mask technique: seed a PRNG, build a half
 * mask, mirror it, then color pixels from a palette. Deterministic per seed —
 * no binary art assets needed, infinitely fresh visuals.
 */

export interface SpriteGrid {
  size: number;
  /** rgba color per pixel ('' = transparent) */
  px: string[][];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Game piece sprite: round-ish pixel blob with a highlight & inner glyph. */
export function pieceSprite(seed: number, palette: string[], size = 11): SpriteGrid {
  const rnd = mulberry32(seed);
  const [main, dark, light] = [palette[0] ?? '#e8965a', palette[1] ?? '#c96f3b', palette[2] ?? '#f7c59f'];
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const R = size / 2 - 0.6;
  const px: string[][] = [];
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d > R) { row.push(''); continue; }
      if (d > R - 1.2) { row.push(shade(dark, -0.05)); continue; } // rim
      // inner texture: deterministic speckles
      const v = rnd();
      let c = main;
      if (v > 0.86) c = light;
      else if (v < 0.1) c = shade(main, -0.12);
      row.push(c);
    }
    px.push(row);
  }
  // highlight arc (top-left)
  for (let y = 1; y < Math.floor(size / 2); y++) {
    for (let x = 1; x < Math.floor(size / 2) + 1; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d < R - 1.6 && d > R - 3.4) px[y][x] = light;
    }
  }
  return { size, px };
}

/** Avatar sprite: symmetric pixel face with eyes/mouth variants. */
export function avatarSprite(seed: number, palette: string[], size = 11): SpriteGrid {
  const rnd = mulberry32(seed);
  const [main, dark, light] = [palette[0] ?? '#84cc16', palette[1] ?? '#365314', palette[2] ?? '#ecfccb'];
  const half = Math.ceil(size / 2);
  const mask: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < half; x++) {
      const edge = x === 0 || y === 0 || y === size - 1;
      row.push(!edge || rnd() > 0.55);
    }
    mask.push(row);
  }
  const px: string[][] = [];
  const eyeY = Math.floor(size * 0.38);
  const mouthY = Math.floor(size * 0.68);
  const eyeD = Math.floor(size * 0.16);
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < size; x++) {
      const mx = x < half ? x : size - 1 - x;
      if (!mask[y][mx]) { row.push(''); continue; }
      const dEye = Math.sqrt((mx - size * 0.32) ** 2 + (y - eyeY) ** 2);
      const dEye2 = Math.sqrt((mx - size * 0.68) ** 2 + (y - eyeY) ** 2);
      const dMouth = Math.abs(y - mouthY) + Math.abs(mx - size / 2) * 0.35;
      if (dEye < eyeD || dEye2 < eyeD) row.push(dark); // eyes
      else if (dMouth < 1.1 && mx > 2 && mx < size - 3) row.push(dark); // mouth
      else if (rnd() > 0.9) row.push(light);
      else row.push(main);
    }
    px.push(row);
  }
  return { size, px };
}

/** Render a SpriteGrid onto a canvas 2d context (used by PixelSprite component). */
export function drawSprite(ctx: CanvasRenderingContext2D, grid: SpriteGrid, scale: number, glow?: string) {
  const { size, px } = grid;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size * scale, size * scale);
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = scale * 1.5;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = px[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  ctx.shadowBlur = 0;
}

export function spriteToDataUrl(grid: SpriteGrid, scale = 8, glow?: string): string {
  const cv = document.createElement('canvas');
  cv.width = grid.size * scale;
  cv.height = grid.size * scale;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  drawSprite(ctx, grid, scale, glow);
  return cv.toDataURL();
}
