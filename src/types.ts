export type Language = 'en' | 'ar';
export type Currency = 'JOD' | 'USD' | 'ILS' | 'IQD' | 'SAR' | 'AED' | 'LYD' | 'EGP';

export interface CalculationResults {
  totalFOBCost: number;
  totalLandedCost: number;
  costPerUnit: number;
  breakdown: {
    baseCost: number;
    shipping: number;
    customs: number;
    fees: number;
    taxes: number;
  };
}

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export interface AppSettings {
  userName: string;
  businessName: string;
  defaultVatRate: number;
  defaultCustomsDuty: number;
  defaultLanguage: Language;
  enableAnimations: boolean;
  aiVerbosity: 'concise' | 'detailed';
  theme: 'light' | 'soft' | 'modern';
  darkMode: boolean;
  currency: Currency;
  primaryColor?: string;
  fontSize?: number;
  mandatorySerial?: boolean;
  lowStockThreshold?: number;
  soundEffects?: boolean;
  toastNotifications?: boolean;
  useManualExchangeRates?: boolean;
  exchangeRateUSD_ILS?: number;
  exchangeRateJOD_ILS?: number;
  exchangeRateJOD_USD?: number;
  taxRegistrationNumber?: string;
  companyLogoUrl?: string;
  businessPhone?: string;
  businessAddress?: string;
  businessEmail?: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  quantity: number;
  unitCost: number;
  costPrice?: number;
  sellingPrice: number;
  currency?: string;
  status: StockStatus;
  serialNumber?: string;
  lowStockThreshold?: number;
  dateAdded: number;
  expiryDate?: number;
  type?: 'product' | 'asset';
  warehouseId?: string;
  baseCostPrice?: number;
  taxRate?: number;
  additionalCosts?: number;
  /**
   * Optional selling pack (box, carton). Stock, cost and selling price stay per single unit;
   * a pack is `packSize` units sold at `packPrice`. Active only when packSize is a whole number >= 2.
   */
  unitName?: string;
  packName?: string;
  packSize?: number;
  packPrice?: number;
  packBarcode?: string;
}

/** Manual stock change (not caused by an invoice). Invoices already carry their own stock effect. */
export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: 'initial' | 'adjustment';
  before: number;
  after: number;
  delta: number;
  reason?: string;
  timestamp: number;
  userName?: string;
  /** Product cost per unit when the stock changed, so the books value it at that cost. Missing on older movements. */
  unitCost?: number;
  costCurrency?: string;
  /** Moved between warehouses: the store's stock value did not change. */
  transfer?: boolean;
}

export interface ProductLog {
  id: string;
  productId: string;
  action: 'create' | 'update_stock' | 'update_info' | 'delete' | 'sale' | 'purchase';
  changeType: 'increment' | 'decrement' | 'set';
  quantityDelta?: number;
  previousValue: any;
  newValue: any;
  timestamp: number;
  userId?: string;
  userName?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  contact: string;
  salary: number;
  /** Currency the salary amount is stored in. Older rows omit it and mean the store currency. */
  currency?: Currency;
  status: 'active' | 'on-leave' | 'terminated';
  hiredDate: number;
}

export interface Customer {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  createdAt: string;
  totalDebt: number;
  currency: Currency;
}

export type ChequeType = 'incoming' | 'outgoing';
export type ChequeStatus = 'pending' | 'cashed' | 'bounced' | 'endorsed' | 'returned';
export type ChequeContactType = 'customer' | 'supplier';

export interface Cheque {
  id: string;
  chequeNumber: string;
  bankName: string;
  amount: number;
  currency: Currency;
  /** YYYY-MM-DD */
  dueDate: string;
  type: ChequeType;
  status: ChequeStatus;
  drawerName: string;
  contactType: ChequeContactType | null;
  /** Customer id from the sync store; suppliers have no id, only a name. */
  contactId: string | null;
  contactName: string;
  /** Who an incoming cheque was endorsed over to. Required when status is 'endorsed'. */
  endorsedTo: string;
  notes: string;
  statusChangedAt: string | null;
  createdAt: string;
}

export type ChequeInput = Omit<Cheque, 'id' | 'status' | 'statusChangedAt' | 'createdAt' | 'endorsedTo'>;

export interface ChequeFilters {
  status: ChequeStatus | 'all';
  bank: string;
  from: string;
  to: string;
  search: string;
}

export interface CustomerTransaction {
  id: string;
  transactionId: string;
  customerId: string;
  type: 'invoice' | 'payment';
  invoiceId?: string;
  amount: number;
  currency: Currency;
  exchangeRate: number;
  date: string;
  notes: string;
  remainingBalanceAfter: number;
  /** Set when the payment was also received into the vault, so deleting it can return the cash. */
  vaultRecordId?: string;
}

export interface ProductDetails {
  name: string;
  quantity: number;
  unitCost: number;
  currency: string;
}

export interface LogisticsCosts {
  exchangeRate: number;
  shippingCost: number;
  customsDuty: number;
  isDutyFixed: boolean;
  clearanceFees: number;
  inlandTransport: number;
  vatRate: number;
  insuranceCost?: number;
  inspectionFees?: number;
}

export interface Transaction {
  id: string;
  productId: string;
  productName: string;
  type: 'sale' | 'purchase';
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  timestamp: number;
  invoiceId?: string;
  serialNumber?: string;
}

export interface InvoiceItem {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Snapshot at issue time so reprints stay stable if the product SKU later changes. */
  sku?: string;
  /** Product cost per single unit at sale time, in costCurrency (also on pack lines). Profit uses this, not today's cost. */
  unitCost?: number;
  costCurrency?: string;
  /**
   * Set when the line is sold or bought by the pack: quantity and unitPrice are per pack,
   * and the stock moves quantity × packSize units. Snapshot, so a later change of pack size keeps old invoices right.
   */
  packSize?: number;
  packName?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName?: string;
  supplierName?: string;
  date: number;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  /** VAT % stored with the invoice. Reprints must use this, not the current settings. */
  vatRate?: number;
  totalAmount: number;
  type: 'sale' | 'purchase';
  currency: Currency;
  discount?: number;
  cashReceived?: number;
  changeDue?: number;
  /** 'credit' = آجل: no cash enters the vault until the customer pays. Missing = cash. */
  paymentMethod?: 'cash' | 'card' | 'wallet' | 'credit';
  customerId?: string;
  /** Credit sale: debt added to the customer, in the customer's own currency. */
  debtAmount?: number;
  debtCurrency?: Currency;
  /** Whether saving this invoice moved the cash vault. Missing on invoices saved before card/wallet were excluded. */
  vaultPosted?: boolean;
  /** Purchases: each product's average unit cost before and after this receipt, so deleting it can put the cost back. */
  costChanges?: Record<string, { before: number; after: number }>;
  /** The account that created the invoice. Stamped by merchant_commit; a device cannot set or change it. */
  actorId?: string;
  actorEmail?: string;
}

export type VaultSource =
  | 'sale_invoice'
  | 'purchase_invoice'
  | 'expense'
  | 'payroll'
  | 'customer_payment'
  | 'manual'
  | 'reversal';

export interface VaultTransaction {
  id: string;
  type: 'income' | 'expense';
  category: 'sale' | 'purchase' | 'salary' | 'manual' | 'other';
  amount: number;
  currency: Currency;
  description?: string;
  timestamp: number;
  balanceAfter: number;
  /** Which part of the app produced this movement. */
  source?: VaultSource;
  /** Id of the related document (invoice id, payroll id, customer id...). */
  refId?: string;
}

export interface Vault {
  currentBalance: number;
  balanceJOD?: number;
  balanceILS?: number;
  balanceUSD?: number;
  balanceIQD?: number;
  balanceSAR?: number;
  balanceAED?: number;
  balanceLYD?: number;
  balanceEGP?: number;
  lastUpdated: number;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  monthYear: string;           // 'MM-YYYY' or similar
  allowances: number;
  deductions: number;
  netSalary: number;
  paymentDate: number;         // timestamp URL
  paymentStatus: 'pending' | 'paid';
  currency?: Currency;
}

export interface Warehouse {
  id: string;
  name: string;
  location?: string;
  parentId: string | null; // NULL if main, or ID of parent warehouse if sub-warehouse
  createdAt: number;
}

export type InventoryAuditStatus = 'draft' | 'completed';

/** One stocktake session. Rows live in Supabase `inventory_audits`. */
export interface InventoryAudit {
  id: string;
  auditNumber: string;
  status: InventoryAuditStatus;
  notes: string;
  createdAt: string;
  createdBy: string;
}

/** One counted product. `difference` is actualQty − expectedQty. */
export interface InventoryAuditItem {
  id: string;
  auditId: string;
  productId: string;
  expectedQty: number;
  actualQty: number;
  difference: number;
  unitCost: number;
}

/** Count-sheet fields kept beside the row so the archive can show a name after reload. */
export interface InventoryAuditLine extends InventoryAuditItem {
  productName: string;
  sku: string;
  currency: string;
}

export interface AuditLog {
  id: string;
  action: string;
  details: string;
  timestamp: number;
  category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll' | 'auth';
  userName: string;
  email: string;
}


