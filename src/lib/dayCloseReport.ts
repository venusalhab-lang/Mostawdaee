import type { DayCloseSnapshot } from './dayClose';
import { escapeHtml } from './invoiceDocument';

export function buildDayCloseReportHtml(o: {
  isAr: boolean;
  businessName: string;
  snapshot: DayCloseSnapshot;
  money: (value: number, currency: string) => string;
  formatDate: (time: number) => string;
}): string {
  const ar = o.isAr;
  const L = (a: string, e: string) => (ar ? a : e);
  const m = (v: number, c: string) => escapeHtml(o.money(v, c));
  const row = (label: string, value: string) =>
    `<tr><td>${escapeHtml(label)}</td><td class="v">${value}</td></tr>`;

  const sales = o.snapshot.sales
    .map((s) => {
      return `
      <h2>${escapeHtml(s.currency)}</h2>
      <table>
        ${row(L('عدد المبيعات', 'Sales count'), String(s.salesCount))}
        ${row(L('إجمالي المبيعات', 'Gross sales'), m(s.sales, s.currency))}
        ${row(L('مرتجعات', 'Returns'), m(s.returns, s.currency))}
        ${row(L('صافي المبيعات', 'Net sales'), m(s.net, s.currency))}
        ${row(L('نقدي', 'Cash'), m(s.byMethod.cash, s.currency))}
        ${row(L('بطاقة', 'Card'), m(s.byMethod.card, s.currency))}
        ${row(L('محفظة', 'Wallet'), m(s.byMethod.wallet, s.currency))}
        ${row(L('آجل', 'On credit'), m(s.byMethod.credit, s.currency))}
      </table>`;
    })
    .join('') || `<p class="muted">${escapeHtml(L('لا مبيعات اليوم بعد.', 'No sales yet today.'))}</p>`;

  const vaultBal = Object.entries(o.snapshot.vaultBalances)
    .filter(([, v]) => v !== 0)
    .map(([c, v]) => row(c, m(v, c)))
    .join('');

  const vaultFlow = o.snapshot.vaultFlows
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.currency)}</td><td class="v">${m(f.income, f.currency)}</td><td class="v">${m(f.expense, f.currency)}</td></tr>`,
    )
    .join('');

  const debts = o.snapshot.debts.rows
    .map((r) => row(r.currency, m(r.amount, r.currency)))
    .join('');

  const cashed = Object.entries(o.snapshot.chequesCashedToday.byCurrency)
    .map(([c, v]) => row(c, m(v, c)))
    .join('');

  const openShifts = o.snapshot.openShifts
    .map((s) => `<li>${escapeHtml(s.label)} — ${escapeHtml(o.formatDate(s.openedAt))}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(L('إقفال يوم المتجر', 'Store day close'))}</title>
<style>
  body{font-family:system-ui,sans-serif;font-size:13px;color:#0f172a;margin:16px;max-width:420px}
  h1{font-size:16px;margin:0 0 4px}
  h2{font-size:14px;margin:16px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .meta{color:#64748b;font-size:11px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;margin:0 0 8px}
  td{padding:3px 0;vertical-align:top}
  td.v{text-align:end;font-variant-numeric:tabular-nums;font-weight:700}
  .muted{color:#94a3b8}
  .note{font-size:11px;color:#64748b;margin-top:16px;line-height:1.45}
  ul{margin:4px 0 8px;padding-inline-start:18px}
</style>
</head>
<body>
  <h1>${escapeHtml(o.businessName || L('مستودعي', 'Mostawdaee'))}</h1>
  <div class="meta">
    ${escapeHtml(L('إقفال يوم المتجر', 'Store day close'))} · ${escapeHtml(o.snapshot.dayIso)}<br/>
    ${escapeHtml(L('حتى', 'As of'))} ${escapeHtml(o.formatDate(o.snapshot.asOf))}
  </div>

  <h2>${escapeHtml(L('مبيعات اليوم (كل الكاشيرات)', 'Today’s sales (all cashiers)'))}</h2>
  ${sales}

  <h2>${escapeHtml(L('أرصدة الخزنة الآن', 'Vault balances now'))}</h2>
  <table>${vaultBal || row('—', '—')}</table>

  <h2>${escapeHtml(L('حركة الخزنة اليوم', 'Vault movement today'))}</h2>
  <table>
    <tr><td></td><td class="v">${escapeHtml(L('دخل', 'In'))}</td><td class="v">${escapeHtml(L('خرج', 'Out'))}</td></tr>
    ${vaultFlow || `<tr><td colspan="3" class="muted">${escapeHtml(L('لا حركة.', 'No movement.'))}</td></tr>`}
  </table>

  <h2>${escapeHtml(L(`ديون العملاء (${o.snapshot.debts.count})`, `Customer debts (${o.snapshot.debts.count})`))}</h2>
  <table>${debts || row('—', '—')}</table>

  <h2>${escapeHtml(L(`شيكات صُرفت اليوم (${o.snapshot.chequesCashedToday.count})`, `Cheques cashed today (${o.snapshot.chequesCashedToday.count})`))}</h2>
  <table>${cashed || row('—', '—')}</table>
  <p class="muted">${escapeHtml(L(`شيكات معلّقة متأخرة: ${o.snapshot.chequesOverduePending}`, `Overdue pending cheques: ${o.snapshot.chequesOverduePending}`))}</p>

  <h2>${escapeHtml(L('عدّ الأدراج', 'Drawer counts'))}</h2>
  <p>${escapeHtml(L(`ورديات أُغلقت اليوم: ${o.snapshot.shiftsClosedToday}`, `Shifts closed today: ${o.snapshot.shiftsClosedToday}`))}</p>
  ${
    o.snapshot.openShifts.length
      ? `<p>${escapeHtml(L('ما زال مفتوحاً:', 'Still open:'))}</p><ul>${openShifts}</ul>`
      : `<p class="muted">${escapeHtml(L('لا عدّ درج مفتوح.', 'No open drawer counts.'))}</p>`
  }

  <p class="note">
    ${escapeHtml(
      L(
        'هذا ملخص للمطابقة فقط. لا يحرّك الخزنة ولا يغلق البيع. فرق عدّ الدرج يبقى في تقرير Z لكل كاشير.',
        'Read-only reconciliation. Does not move the vault or lock sales. Drawer variance stays on each cashier’s Z-report.',
      ),
    )}
  </p>
</body>
</html>`;
}
