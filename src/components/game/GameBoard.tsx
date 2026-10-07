'use client';

/**
 * GameBoard — 9×7 grid rendered like the physical wooden board:
 * each numbered cell shows its numeral in the top-left corner (upright for the
 * bottom player) and mirrored at bottom-right (upright for the top player).
 * Supports board skins, pixel piece sprites, drop animations, win highlights.
 */
import { useEffect, useRef, useState } from 'react';
import { COLS, ROWS, GameState, mirrorCellIndex } from '@/lib/game/engine';
import { PieceDisc } from '@/components/shared/PixelSprite';

/** Hover-capable devices show a ghost preview; touch devices must never
 *  (touch fires no mouseleave, so the ghost would stick over the last piece). */
function useCanHover(): boolean {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const upd = () => setCanHover(mq.matches);
    upd();
    mq.addEventListener?.('change', upd);
    return () => mq.removeEventListener?.('change', upd);
  }, []);
  return canHover;
}

export interface BoardPalette {
  frame: string; frame2: string; cell: string; cell2: string;
  line: string; numeral: string; hole: string; grass: string;
}

export function GameBoard({
  state, palette, piece1, piece2, onColumnClick, interactive, rotated,
  hintCol, lastMoveSeq,
}: {
  state: GameState;
  palette: BoardPalette;
  piece1: string;
  piece2: string;
  onColumnClick?: (col: number) => void;
  interactive?: boolean;
  rotated?: boolean;
  hintCol?: number | null;
  lastMoveSeq?: number;
}) {
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [dropAnim, setDropAnim] = useState<{ cell: number; seq: number } | null>(null);
  const canHover = useCanHover();
  const prevPly = useRef(state.ply);
  const seqRef = useRef(0);

  useEffect(() => {
    if (state.ply !== prevPly.current && state.lastMove !== null) {
      prevPly.current = state.ply;
      seqRef.current++;
      setDropAnim({ cell: state.lastMove, seq: seqRef.current });
    }
  }, [state.ply, state.lastMove]);

  const winSet = new Set(state.result?.winCells ?? []);

  /** display index -> logical index (storage is bottom-first; display is top-first; mirror for rotated view) */
  const d2l = (d: number) => {
    const r = Math.floor(d / COLS);
    const c = d % COLS;
    const row = ROWS - 1 - r; // flip: storage row 0 (bottom) renders last
    const idx = row * COLS + c;
    return rotated ? mirrorCellIndex(idx) : idx;
  };

  const winNums = state.result?.numbers ?? [];

  return (
    <div
      className="board-frame relative mx-auto w-full max-w-[600px] select-none rounded-xl"
      style={{ background: `linear-gradient(150deg, ${palette.frame}, ${palette.frame2})`, borderColor: palette.frame2 }}
      dir="ltr"
    >
      {/* grass fringe like the physical board */}
      <div className="pointer-events-none absolute inset-x-1 top-0 h-1.5 rounded-b" style={{ background: palette.grass, opacity: 0.8 }} />

      <div className="grid grid-cols-9 gap-[3px] p-2" role="grid" aria-label="game board">
        {Array.from({ length: ROWS * COLS }, (_, d) => d).map((d) => {
          const idx = d2l(d);
          const cell = state.cells[idx];
          const row = Math.floor(idx / COLS);
          const col = idx % COLS;
          const isHoverCol = hoverCol === col;
          const isNext = interactive && canHover && hoverCol === col && state.heights[col] === row && !state.result;
          const isLast = state.lastMove === idx;
          const isWin = winSet.has(idx);
          const isDrop = dropAnim?.cell === idx;
          const displayNum = cell.n;
          const winGlow = isWin && winNums.length > 0;
          /* ghost preview: the piece that WOULD land here */
          const ghostSide: 1 | 2 = state.turn;
          const ghostCode = ghostSide === 1 ? piece1 : piece2;

          return (
            <div
              key={d}
              role="gridcell"
              aria-label={displayNum ? `cell ${displayNum}` : 'empty cell'}
              className="relative aspect-square cursor-pointer overflow-hidden rounded-[5px] transition-transform duration-100"
              style={{
                background: `linear-gradient(140deg, ${palette.cell}, ${palette.cell2})`,
                boxShadow: isNext
                  ? `inset 0 0 0 2px ${palette.numeral}, 0 0 14px ${palette.grass}`
                  : 'inset 0 -2px 4px rgba(0,0,0,0.18)',
                outline: hoverCol === col ? `2px solid ${palette.grass}55` : 'none',
                transform: isHoverCol ? 'translateY(-1px)' : undefined,
              }}
              onMouseEnter={() => { if (canHover) setHoverCol(col); }}
              onMouseLeave={() => { if (canHover) setHoverCol((h) => (h === col ? null : h)); }}
              onClick={() => onColumnClick?.(col)}
              onTouchStart={() => { if (!canHover) setHoverCol(null); }}
            >
              {/* hole */}
              <div
                className="absolute left-1/2 top-1/2 h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: palette.hole, boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.4)' }}
              />
              {/* ghost drop preview (semi-transparent piece in the landing cell) */}
              {isNext && cell.o === null && (
                <div className="pointer-events-none absolute inset-[8%] flex animate-pop items-center justify-center opacity-40">
                  <div className="h-full w-full rounded-full">
                    <PieceDisc code={ghostCode} side={ghostSide} size={44} />
                  </div>
                </div>
              )}
              {/* numerals: top-left upright + bottom-right mirrored (like the printed board) */}
              {displayNum !== null && (
                <>
                  <span
                    className="absolute left-[6%] top-[2%] text-[clamp(9px,2.2vw,15px)] font-black leading-none"
                    style={{ color: palette.numeral, textShadow: '0 1px 0 rgba(255,255,255,0.25)' }}
                  >
                    {displayNum}
                  </span>
                  <span
                    className="absolute bottom-[2%] right-[6%] rotate-180 text-[clamp(9px,2.2vw,15px)] font-black leading-none opacity-80"
                    style={{ color: palette.numeral }}
                  >
                    {displayNum}
                  </span>
                </>
              )}
              {/* hint marker */}
              {hintCol === col && state.heights[col] === row && !state.result && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                </div>
              )}
              {/* placed piece */}
              {cell.o !== null && (
                <div
                  className={`absolute inset-[8%] flex items-center justify-center ${isDrop ? 'animate-drop' : ''}`}
                  key={isDrop ? `drop-${dropAnim?.seq}` : `p-${idx}`}
                >
                  <div className={`h-full w-full rounded-full ${isWin ? 'animate-win-pulse' : ''}`}
                    style={{ filter: winGlow ? 'drop-shadow(0 0 8px rgba(251,191,36,0.9))' : undefined }}
                  >
                    <PieceDisc code={cell.o === 1 ? piece1 : piece2} side={(cell.o === 1 ? 1 : 2) as 1 | 2} size={44} />
                  </div>
                  {isLast && !isWin && (
                    <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/60" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* column hover strip: full-height tint + top marker (hover devices only) */}
      {interactive && canHover && hoverCol !== null && !state.result && (
        <div
          className="pointer-events-none absolute top-0 h-full transition-opacity"
          style={{ left: `calc(${(hoverCol / COLS) * 100}% + ${100 / COLS / 2}%)`, transform: 'translateX(-50%)', width: `${100 / COLS}%` }}
        >
          <div
            className="absolute inset-0 rounded-md"
            style={{ background: `linear-gradient(to bottom, ${palette.grass}30, ${palette.grass}10 45%, transparent 80%)` }}
          />
          <div className="absolute inset-x-0 top-0 mx-auto h-1.5 w-1/2 rounded-b-lg" style={{ background: palette.grass, opacity: 0.95 }} />
        </div>
      )}
    </div>
  );
}
