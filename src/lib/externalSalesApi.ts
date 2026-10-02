/**
 * Optional third-party sales/barcode API. Disabled unless VITE_EXTERNAL_SALES_API is set at build time,
 * so production builds never POST to (or queue for) a host that does not exist.
 */
export function getExternalSalesApi(): string {
  return String((import.meta as any).env?.VITE_EXTERNAL_SALES_API || '').replace(/\/$/, '');
}
