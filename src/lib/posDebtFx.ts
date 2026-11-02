import {
  conversionBasis,
  roundMoney,
  safeConvertMoney,
  type ConversionBasis,
} from './exchangeRates';
import type { Currency } from '../types';

export type PosDebtFxPlan =
  | { ok: true; debtAmount: number; debtCurrency: Currency; basis: ConversionBasis | null }
  | { ok: false; reason: 'no_rate' | 'convert_failed'; basis: ConversionBasis | null };

/**
 * Plans the customer-debt leg of a POS split/credit sale.
 * Same-currency debts always pass. Cross-currency debts require a trusted
 * conversionBasis (manual merchant rates or fresh live rates) — never built-in defaults.
 */
export function planPosCreditDebt(input: {
  owed: number;
  billCurrency: Currency;
  customerCurrency: Currency;
  settings: Parameters<typeof conversionBasis>[2];
  liveRates: Record<string, number> | null;
  liveAt: number | null;
  usdUnitRates: Record<string, number>;
  now?: number;
}): PosDebtFxPlan {
  const owed = roundMoney(input.owed, input.billCurrency);
  if (!(owed > 0)) {
    return { ok: false, reason: 'convert_failed', basis: null };
  }
  if (input.customerCurrency === input.billCurrency) {
    return {
      ok: true,
      debtAmount: owed,
      debtCurrency: input.customerCurrency,
      basis: null,
    };
  }
  const basis = conversionBasis(
    input.billCurrency,
    input.customerCurrency,
    input.settings,
    input.liveRates,
    input.liveAt,
    input.now,
  );
  if (!basis.ok) {
    return { ok: false, reason: 'no_rate', basis };
  }
  const converted = safeConvertMoney(owed, input.billCurrency, input.customerCurrency, input.usdUnitRates);
  if (converted === null || !(converted > 0)) {
    return { ok: false, reason: 'convert_failed', basis };
  }
  return {
    ok: true,
    debtAmount: converted,
    debtCurrency: input.customerCurrency,
    basis,
  };
}
