/**
 * Hex field geometry — PURE functions, no game rules (docs/battle.md, section 10).
 *
 * The field is an "odd-r" offset grid drawn with a pointy top: odd rows are
 * shifted half a cell to the right. A cell is addressed by its offset
 * coordinates (x = column, y = row), which is what the transport (sandbox,
 * WebSocket) sends around. Internally the maths is done in CUBE coordinates,
 * where the distance is a simple max of the three differences.
 *
 * This module lives in /shared because the client needs the very same functions
 * to DRAW the field and the unit circles. That does not make it the owner of
 * any game rule: the client only draws, Battle decides who may hit whom.
 */

import type { Hex } from './index';

/** Cube coordinates: x + y + z = 0. Used only inside this module. */
type Cube = { x: number; y: number; z: number };

/**
 * Neighbour offsets (column, row) for a cell on an EVEN row.
 * Six neighbours, all at distance 1 (verified in hex.test.ts).
 */
const EVEN_ROW_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/**
 * Neighbour offsets (column, row) for a cell on an ODD row. The odd row is
 * shifted half a cell right, so its diagonals lean the other way.
 */
const ODD_ROW_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

/** True for a row number that uses the odd-row layout (0, 2, 4 -> even). */
function isOddRow(row: number): boolean {
  return (row & 1) === 1;
}

/**
 * Offset cell -> cube coordinates.
 * cx = x - (y - (y & 1)) / 2, cz = y, cy = -cx - cz.
 */
export function toCube(hex: Hex): Cube {
  const cx = hex.x - (hex.y - (hex.y & 1)) / 2;
  const cz = hex.y;
  // `|| 0` only ever replaces -0 with 0, so the cube coordinates stay plain
  // numbers that compare and print exactly as written in the docs.
  const cy = -cx - cz || 0;

  return { x: cx, y: cy, z: cz };
}

/**
 * Hex distance in cells: the largest of the three cube differences.
 * Symmetric by construction, and always 1 for a direct neighbour.
 */
export function distance(a: Hex, b: Hex): number {
  const first = toCube(a);
  const second = toCube(b);

  return Math.max(
    Math.abs(first.x - second.x),
    Math.abs(first.y - second.y),
    Math.abs(first.z - second.z),
  );
}

/**
 * All six cells around `hex`. Cells outside the field are NOT filtered here —
 * the caller decides with isInside(), because a board of a given size is a
 * battle rule, not geometry.
 */
export function neighbors(hex: Hex): Hex[] {
  const offsets = isOddRow(hex.y) ? ODD_ROW_OFFSETS : EVEN_ROW_OFFSETS;

  return offsets.map(([dx, dy]) => ({ x: hex.x + dx, y: hex.y + dy }));
}

/** True when the cell lies inside a field of the given size (0-based columns/rows). */
export function isInside(hex: Hex, fieldWidth: number, fieldHeight: number): boolean {
  return hex.x >= 0 && hex.x < fieldWidth && hex.y >= 0 && hex.y < fieldHeight;
}

/** True when both cells describe the same cell. */
export function isSameHex(a: Hex, b: Hex): boolean {
  return a.x === b.x && a.y === b.y;
}