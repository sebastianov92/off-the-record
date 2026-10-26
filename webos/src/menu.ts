// Remote navigation for the dock and the side panels: a column of rows, each
// either a row of buttons (Left/Right move between them), a slider (Left/Right
// change it), a toggle or an option. Up/Down skip disabled rows.
export type RowKind = 'buttons' | 'slider' | 'toggle' | 'option';

export interface MenuRow {
  id: string;
  kind: RowKind;
  size?: number; // buttons in the row
  disabled?: boolean;
}

export interface Cursor {
  row: number;
  col: number;
}

export function clampCursor(rows: MenuRow[], cursor: Cursor): Cursor {
  let row = Math.min(Math.max(cursor.row, 0), rows.length - 1);
  if (rows[row]?.disabled) row = moveRow(rows, { row, col: 0 }, 1).row;
  if (rows[row]?.disabled) row = moveRow(rows, { row, col: 0 }, -1).row;
  const size = rows[row]?.kind === 'buttons' ? (rows[row].size ?? 1) : 1;
  return { row, col: Math.min(Math.max(cursor.col, 0), size - 1) };
}

export function moveRow(rows: MenuRow[], cursor: Cursor, step: 1 | -1): Cursor {
  for (let row = cursor.row + step; row >= 0 && row < rows.length; row += step) {
    if (!rows[row].disabled) {
      const size = rows[row].kind === 'buttons' ? (rows[row].size ?? 1) : 1;
      return { row, col: Math.min(cursor.col, size - 1) };
    }
  }
  return cursor;
}

export function moveCol(rows: MenuRow[], cursor: Cursor, step: 1 | -1): Cursor {
  const size = rows[cursor.row]?.size ?? 1;
  return { row: cursor.row, col: Math.min(Math.max(cursor.col + step, 0), size - 1) };
}
