import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SalesLogCard from '../../components/SalesLogCard';
import type { Invoice } from '../../types';

const NOW = new Date(2026, 9, 11, 14, 0).getTime();
const at = (h: number, m: number) => new Date(2026, 9, 11, h, m).getTime();

const sale = (id: string, date: number, extra: Partial<Invoice>): Invoice => ({
  id, invoiceNumber: `S-${id}`, date, items: [], subtotal: 0, taxAmount: 0, totalAmount: 0, type: 'sale', currency: 'JOD', ...extra,
});

const invoices: Invoice[] = [
  sale('1', at(9, 5), {
    actorId: 'cashier', actorEmail: 'ahmad@shop.com', totalAmount: 9.5, paymentMethod: 'cash',
    items: [
      { productId: 'j', description: 'عصير', quantity: 1, unitPrice: 9, total: 9, packSize: 20, packName: 'صندوق' },
      { productId: 't', description: 'شاي', quantity: 1, unitPrice: 0.5, total: 0.5 },
    ],
  }),
  sale('2', at(11, 30), { actorId: 'owner', totalAmount: 2, paymentMethod: 'card', items: [{ productId: 't', description: 'شاي', quantity: 4, unitPrice: 0.5, total: 2 }] }),
  sale('3', at(12, 0), { totalAmount: 1, items: [] }),
  sale('yesterday', at(9, 0) - 86_400_000, { actorId: 'cashier', totalAmount: 50 }),
];

const html = renderToStaticMarkup(
  <SalesLogCard
    invoices={invoices}
    range="day"
    now={NOW}
    isRtl
    storeCurrency="JOD"
    sellers={{ userId: 'owner', userEmail: 'owner@shop.com', ownerId: 'owner', ownerEmail: 'owner@shop.com', pendingIds: new Set() }}
  />,
);

describe('SalesLogCard', () => {
  it('lists today\'s sales with time, items, seller and payment', () => {
    expect(html).toContain('سجل مبيعات اليوم');
    expect(html).toContain('3 عملية بيع');
    expect(html).toContain('عصير × 1 صندوق (20)، شاي × 1');
    expect(html).toContain('ahmad@shop.com');
    expect(html).toContain('نقدي');
    expect(html).toContain('بطاقة');
    expect(html).not.toContain('50.000');
  });

  it('offers a filter per seller and explains unrecorded sellers', () => {
    expect(html).toContain('تصفية حسب البائع');
    expect(html).toContain('أنت');
    expect(html).toContain('غير مسجّل');
    expect(html).toContain('مبيعات حُفظت قبل أن يسجّل النظام اسم البائع');
  });
});
