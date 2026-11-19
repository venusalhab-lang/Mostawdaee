-- PART 1/3: allow store_notes collection
-- Run alone, then Part 2, then Part 3.

ALTER TABLE public.merchant_documents DROP CONSTRAINT IF EXISTS merchant_documents_collection_check;
ALTER TABLE public.merchant_documents ADD CONSTRAINT merchant_documents_collection_check CHECK (collection IN (
    'settings', 'inventory', 'invoices', 'employees', 'payroll', 'customers',
    'customer_transactions', 'stock_movements', 'vault_records', 'warehouses', 'audit_logs',
    'invoice_numbers', 'suppliers', 'supplier_transactions', 'shifts', 'orders', 'store_notes'
));
