export type Language = 'en' | 'ar';
export type Currency = 'JOD' | 'USD' | 'ILS' | 'IQD' | 'SAR' | 'LYD';

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
  totalAmount: number;
  type: 'sale' | 'purchase';
  currency: Currency;
  discount?: number;
  cashReceived?: number;
  changeDue?: number;
  /** 'credit' = آجل: no cash enters the vault until the customer pays. Missing = cash. */
  paymentMethod?: 'cash' | 'card' | 'wallet' | 'credit';
  customerId?: string;
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
  balanceLYD?: number;
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

export interface AuditLog {
  id: string;
  action: string;
  details: string;
  timestamp: number;
  category: 'product' | 'invoice' | 'settings' | 'employee' | 'customer' | 'warehouse' | 'vault' | 'payroll' | 'auth';
  userName: string;
  email: string;
}


