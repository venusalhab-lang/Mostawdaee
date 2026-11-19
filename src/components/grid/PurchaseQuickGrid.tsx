import React, { useMemo } from 'react';
import { Plus, Table2 } from 'lucide-react';
import type { Product } from '../../types';
import EntryGrid, { type EntryGridColumn } from './EntryGrid';
import {
  applyCodeToRow,
  createEmptyPurchaseRows,
  purchaseGridErrorMessage,
  purchaseGridGrandTotal,
  purchaseGridRowTotal,
  type PurchaseGridRow,
} from '../../lib/grid/purchaseGrid';
import { parseGridNumber } from '../../lib/grid/gridMath';
import { formatMoney } from '../../lib/exchangeRates';
import type { Currency } from '../../types';

type Props = {
  rows: PurchaseGridRow[];
  onRowsChange: (rows: PurchaseGridRow[]) => void;
  products: Product[];
  currency: Currency;
  isRtl: boolean;
};

export default function PurchaseQuickGrid({ rows, onRowsChange, products, currency, isRtl }: Props) {
  const locale = isRtl ? 'ar' : 'en-US';
  const grand = useMemo(() => purchaseGridGrandTotal(rows), [rows]);

  const columns = useMemo<EntryGridColumn<PurchaseGridRow>[]>(() => [
    {
      id: 'code',
      header: isRtl ? 'باركود / SKU' : 'Barcode / SKU',
      editable: true,
      mono: true,
      widthClass: 'min-w-[8rem]',
      placeholder: isRtl ? 'امسح أو اكتب الرمز' : 'Scan or type code',
      readValue: (row) => row.code,
      commitValue: (row, raw) => applyCodeToRow({ ...row, code: raw }, products),
    },
    {
      id: 'name',
      header: isRtl ? 'الصنف' : 'Product',
      editable: false,
      widthClass: 'min-w-[10rem]',
      readValue: (row) => row.description,
      placeholder: '—',
    },
    {
      id: 'qty',
      header: isRtl ? 'الكمية' : 'Qty',
      editable: true,
      mono: true,
      align: 'end',
      widthClass: 'w-24',
      inputMode: 'decimal',
      readValue: (row) => row.quantity,
      commitValue: (row, raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return { ...row, quantity: '', errorKey: row.errorKey === 'bad_qty' ? null : row.errorKey };
        const n = parseGridNumber(trimmed);
        // Reject garbage (keep previous value); blank/valid numbers commit.
        if (n === null || Number.isNaN(n)) return row;
        return { ...row, quantity: trimmed, errorKey: row.errorKey === 'bad_qty' ? null : row.errorKey };
      },
    },
    {
      id: 'cost',
      header: isRtl ? `التكلفة (${currency})` : `Cost (${currency})`,
      editable: true,
      mono: true,
      align: 'end',
      widthClass: 'w-28',
      inputMode: 'decimal',
      readValue: (row) => row.unitPrice,
      commitValue: (row, raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return { ...row, unitPrice: '', errorKey: row.errorKey === 'bad_cost' ? null : row.errorKey };
        const n = parseGridNumber(trimmed);
        if (n === null || Number.isNaN(n)) return row;
        return { ...row, unitPrice: trimmed, errorKey: row.errorKey === 'bad_cost' ? null : row.errorKey };
      },
    },
    {
      id: 'total',
      header: isRtl ? 'الإجمالي' : 'Line total',
      editable: false,
      mono: true,
      align: 'end',
      widthClass: 'w-28',
      readValue: (row) => {
        const t = purchaseGridRowTotal(row);
        return t > 0 ? formatMoney(t, currency, locale) : '';
      },
    },
  ], [currency, isRtl, locale, products]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-wide">
          <Table2 size={14} />
          {isRtl ? 'جدول إدخال سريع (Excel)' : 'Quick entry grid (Excel-like)'}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRowsChange([...rows, ...createEmptyPurchaseRows(1)])}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1"><Plus size={12} />{isRtl ? 'صف' : 'Row'}</span>
          </button>
          <button
            type="button"
            onClick={() => onRowsChange([...rows, ...createEmptyPurchaseRows(10)])}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 cursor-pointer"
          >
            {isRtl ? '+10 صفوف' : '+10 rows'}
          </button>
        </div>
      </div>

      <EntryGrid
        rows={rows}
        columns={columns}
        isRtl={isRtl}
        getRowKey={(row) => row.id}
        onRowsChange={onRowsChange}
        onAppendRows={(n = 1) => onRowsChange([...rows, ...createEmptyPurchaseRows(n)])}
        rowError={(row) => !!row.errorKey}
        aria-label={isRtl ? 'جدول بنود الشراء' : 'Purchase lines grid'}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-400 font-medium">
          {isRtl
            ? 'Tab / Enter للتنقل · الأسهم بين الخلايا · Esc لإلغاء التعديل'
            : 'Tab / Enter to move · Arrows between cells · Esc to cancel edit'}
        </p>
        <p className="font-black text-slate-700 dark:text-slate-200">
          {isRtl ? 'مجموع البنود: ' : 'Lines subtotal: '}
          <span className="font-mono text-indigo-600 dark:text-indigo-400">{formatMoney(grand, currency, locale)}</span>
        </p>
      </div>

      {rows.some((r) => r.errorKey) && (
        <ul className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold space-y-0.5">
          {rows.map((row, i) => row.errorKey ? (
            <li key={row.id}>{i + 1}. {purchaseGridErrorMessage(row.errorKey, isRtl)}</li>
          ) : null)}
        </ul>
      )}
    </div>
  );
}
