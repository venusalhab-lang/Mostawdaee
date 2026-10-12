import { describe, expect, it } from 'vitest';
import { buildAccountingReportCsv, buildAccountingReportHtml, type AccountingReport } from '../accountingReport';

const report: AccountingReport = {
  isAr: true,
  businessName: 'متجر <ب>',
  title: 'قائمة الدخل',
  subtitle: 'هذا الشهر',
  currency: 'JOD',
  columns: ['المبلغ'],
  rows: [
    { label: 'الإيرادات', amounts: [], kind: 'section' },
    { code: '4100', label: 'المبيعات', amounts: [20000] },
    { code: '5100', label: 'تكلفة البضاعة المباعة', amounts: [-8000] },
    { label: 'صافي الربح', amounts: [12000], kind: 'total' },
  ],
  notes: ['ملاحظة "مهمة"'],
};

describe('accounting report', () => {
  it('prints an escaped RTL page with amounts in the report currency and losses marked', () => {
    const html = buildAccountingReportHtml(report, 'ar');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('متجر &lt;ب&gt;');
    expect(html).not.toContain('<ب>');
    expect(html).toContain('20.000 د.أ');
    expect(html).toMatch(/class="num neg">‎?-8\.000 د\.أ/);
    expect(html).toContain('<tr class="total">');
  });

  it('exports plain amounts with every cell quoted', () => {
    const csv = buildAccountingReportCsv(report);
    expect(csv.startsWith('\uFEFF"قائمة الدخل","هذا الشهر","JOD"')).toBe(true);
    expect(csv).toContain('"4100","المبيعات","20.000"');
    expect(csv).toContain('"5100","تكلفة البضاعة المباعة","-8.000"');
    expect(csv).toContain('"","الإيرادات",""');
    expect(csv).toContain('"ملاحظة ""مهمة"""');
  });
});
