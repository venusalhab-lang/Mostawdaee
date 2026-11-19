/** Parse a cell number: empty → null; invalid → NaN; otherwise finite number. */
export function parseGridNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function lineTotal(qty: number | null | undefined, unitPrice: number | null | undefined): number {
  const q = Number(qty);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return q * p;
}

export function grandTotal(rows: Array<{ quantity?: number | null; unitPrice?: number | null; total?: number | null }>): number {
  return rows.reduce((sum, row) => {
    if (Number.isFinite(Number(row.total))) return sum + Number(row.total);
    return sum + lineTotal(row.quantity, row.unitPrice);
  }, 0);
}

export function roundMoney(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}
