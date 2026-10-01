/**
 * Tests for the hex geometry (docs/battle.md, section 10).
 *
 * The distances below are worked out BY HAND in cube coordinates and then
 * frozen here, so a change in the conversion cannot pass unnoticed.
 *
 * Reference conversions (cx = x - (y - (y&1))/2, cz = y, cy = -cx - cz):
 *   (0,0) -> (0, 0, 0)   (0,1) -> (0, -1, 1)   (1,0) -> (1, -1, 0)
 *   (2,0) -> (2, -2, 0)  (0,2) -> (-1, -1, 2)  (2,2) -> (1, -3, 2)
 * distance = max(|dcx|, |dcy|, |dcz|)
 */

import { describe, expect, it } from 'vitest';

import { distance, isInside, isSameHex, neighbors, toCube } from '@de-jija/shared/hex';

const WIDTH = 15;
const HEIGHT = 11;

describe('toCube', () => {
  it('converts the reference cells exactly as documented', () => {
    expect(toCube({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(toCube({ x: 0, y: 1 })).toEqual({ x: 0, y: -1, z: 1 });
    expect(toCube({ x: 1, y: 0 })).toEqual({ x: 1, y: -1, z: 0 });
    expect(toCube({ x: 2, y: 0 })).toEqual({ x: 2, y: -2, z: 0 });
    expect(toCube({ x: 0, y: 2 })).toEqual({ x: -1, y: -1, z: 2 });
    expect(toCube({ x: 2, y: 2 })).toEqual({ x: 1, y: -3, z: 2 });
  });

  it('always keeps the cube invariant x + y + z = 0', () => {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        expect(toCube({ x, y }).x + toCube({ x, y }).y + toCube({ x, y }).z).toBe(0);
      }
    }
  });
});

describe('neighbors', () => {
  it('a cell in the middle of the field has exactly 6 neighbours', () => {
    expect(neighbors({ x: 7, y: 4 })).toHaveLength(6);
    expect(neighbors({ x: 1, y: 1 })).toHaveLength(6);
  });

  it('all six neighbours are at distance 1, on an EVEN row', () => {
    // Even row (y = 4) list from docs/battle.md.
    expect(neighbors({ x: 7, y: 4 })).toEqual([
      { x: 8, y: 4 },
      { x: 7, y: 3 },
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ]);

    for (const cell of neighbors({ x: 7, y: 4 })) {
      expect(distance({ x: 7, y: 4 }, cell)).toBe(1);
    }
  });

  it('all six neighbours are at distance 1, on an ODD row', () => {
    // Odd row (y = 3) list from docs/battle.md — the diagonals lean the other way.
    expect(neighbors({ x: 7, y: 3 })).toEqual([
      { x: 8, y: 3 },
      { x: 8, y: 2 },
      { x: 7, y: 2 },
      { x: 6, y: 3 },
      { x: 7, y: 4 },
      { x: 8, y: 4 },
    ]);

    for (const cell of neighbors({ x: 7, y: 3 })) {
      expect(distance({ x: 7, y: 3 }, cell)).toBe(1);
    }
  });

  it('an even and an odd row give DIFFERENT diagonals (odd-r offset)', () => {
    // Row 4 is even, row 5 is odd — the same column, mirrored layout:
    // (6,3) belongs to the even row only, (7,6) to the odd row only.
    const evenRow = neighbors({ x: 7, y: 4 });
    const oddRow = neighbors({ x: 7, y: 5 });

    expect(evenRow).toContainEqual({ x: 6, y: 3 });
    expect(oddRow).not.toContainEqual({ x: 6, y: 3 });
    expect(oddRow).toContainEqual({ x: 7, y: 6 });
    expect(evenRow).not.toContainEqual({ x: 7, y: 6 });
  });

  it('every neighbour of every cell is at distance 1 (whole field)', () => {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        for (const cell of neighbors({ x, y })) {
          expect(distance({ x, y }, cell), `(${x},${y}) -> (${cell.x},${cell.y})`).toBe(1);
        }
      }
    }
  });

  it('a cell is never its own neighbour', () => {
    for (const hex of [
      { x: 0, y: 0 },
      { x: 7, y: 4 },
      { x: 14, y: 10 },
    ]) {
      for (const cell of neighbors(hex)) {
        expect(isSameHex(hex, cell)).toBe(false);
      }
    }
  });

  it('geometry does not clip to the field: filtering is isInside()\'s job', () => {
    // The corner cell still reports 6 cells; some of them are outside the field.
    const corner = neighbors({ x: 0, y: 0 });

    expect(corner).toHaveLength(6);
    expect(corner.filter((cell) => isInside(cell, WIDTH, HEIGHT)).length).toBeLessThan(6);
  });
});

describe('distance', () => {
  it('is 1 for every direct neighbour', () => {
    for (const hex of [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 10, y: 7 },
    ]) {
      for (const cell of neighbors(hex)) {
        expect(distance(hex, cell)).toBe(1);
      }
    }
  });

  it('is 0 for the same cell and symmetric for a pair', () => {
    expect(distance({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
    expect(distance({ x: 4, y: 4 }, { x: 9, y: 6 })).toBe(distance({ x: 9, y: 6 }, { x: 4, y: 4 }));
  });

  it('matches hand-computed distances in cube coordinates', () => {
    // (0,0)->(2,2): (0,0,0) and (1,-3,2) -> max(1,3,2) = 3
    expect(distance({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(3);
    // (0,0)->(2,0): (0,0,0) and (2,-2,0) -> max(2,2,0) = 2
    expect(distance({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(2);
    // (0,0)->(0,2): (0,0,0) and (-1,-1,2) -> max(1,1,2) = 2
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 2 })).toBe(2);
    // (0,1)->(2,2): (0,-1,1) and (1,-3,2) -> max(1,2,1) = 2
    expect(distance({ x: 0, y: 1 }, { x: 2, y: 2 })).toBe(2);
    // (0,0)->(5,0): (0,0,0) and (5,-5,0) -> 5
    expect(distance({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(5);
  });

  it('a cell two rows away really needs two steps', () => {
    expect(distance({ x: 7, y: 4 }, { x: 7, y: 3 })).toBe(1);
    expect(distance({ x: 7, y: 4 }, { x: 7, y: 2 })).toBe(2);
  });
});

describe('isInside', () => {
  it('accepts the whole field and rejects everything around it', () => {
    expect(isInside({ x: 0, y: 0 }, WIDTH, HEIGHT)).toBe(true);
    expect(isInside({ x: WIDTH - 1, y: HEIGHT - 1 }, WIDTH, HEIGHT)).toBe(true);
    expect(isInside({ x: -1, y: 0 }, WIDTH, HEIGHT)).toBe(false);
    expect(isInside({ x: 0, y: -1 }, WIDTH, HEIGHT)).toBe(false);
    expect(isInside({ x: WIDTH, y: 0 }, WIDTH, HEIGHT)).toBe(false);
    expect(isInside({ x: 0, y: HEIGHT }, WIDTH, HEIGHT)).toBe(false);
  });

  it('counts only the neighbours that are really on the field', () => {
    expect(neighbors({ x: 7, y: 4 }).filter((c) => isInside(c, WIDTH, HEIGHT))).toHaveLength(6);

    const corner = neighbors({ x: 0, y: 0 }).filter((c) => isInside(c, WIDTH, HEIGHT));

    expect(corner.length).toBeLessThan(6);
    expect(corner.length).toBeGreaterThan(0);
  });
});

describe('isSameHex', () => {
  it('compares both coordinates', () => {
    expect(isSameHex({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true);
    expect(isSameHex({ x: 3, y: 3 }, { x: 4, y: 3 })).toBe(false);
    expect(isSameHex({ x: 3, y: 3 }, { x: 3, y: 4 })).toBe(false);
  });
});
