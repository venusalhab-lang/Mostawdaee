/**
 * Formats a number without grouping separators (e.g., no thousand-separator commas).
 * This is highly useful for barcode processing, serial quantities, tracking codes,
 * and high-precision numeric fields where standard locale commas would disrupt parsing/scanning.
 *
 * @param num - The number to format
 * @returns The formatted number string without grouping separators
 */
export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-US', { useGrouping: false }).format(num);
};
