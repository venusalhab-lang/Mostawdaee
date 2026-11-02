import { describe, expect, it } from 'vitest';
import { planPosCreditDebt } from '../posDebtFx';

describe('planPosCreditDebt', () => {
  it('passes same-currency debt without needing live rates', () => {
    const plan = planPosCreditDebt({
      owed: 12.5,
      billCurrency: 'JOD',
      customerCurrency: 'JOD',
      settings: null,
      liveRates: null,
      liveAt: null,
      usdUnitRates: { USD: 1, JOD: 0.71 },
    });
    expect(plan).toMatchObject({ ok: true, debtAmount: 12.5, debtCurrency: 'JOD' });
  });

  it('refuses cross-currency debt when only built-in defaults exist', () => {
    const plan = planPosCreditDebt({
      owed: 10,
      billCurrency: 'JOD',
      customerCurrency: 'ILS',
      settings: null,
      liveRates: null,
      liveAt: null,
      usdUnitRates: { USD: 1, JOD: 0.71, ILS: 3.7 },
    });
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: 'no_rate' }));
  });

  it('accepts cross-currency debt with fresh live rates', () => {
    const now = Date.now();
    const live = { USD: 1, JOD: 0.71, ILS: 3.7 };
    const plan = planPosCreditDebt({
      owed: 10,
      billCurrency: 'JOD',
      customerCurrency: 'ILS',
      settings: null,
      liveRates: live,
      liveAt: now - 1000,
      usdUnitRates: live,
      now,
    });
    expect(plan).toEqual(expect.objectContaining({ ok: true, debtCurrency: 'ILS' }));
    if (plan.ok) expect(plan.debtAmount).toBeGreaterThan(0);
  });
});
