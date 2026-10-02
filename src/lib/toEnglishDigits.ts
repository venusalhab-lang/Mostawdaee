/**
 * Converts Eastern Arabic numerals (٠-٩) to standard English/Western Arabic digits (0-9).
 * This is extremely useful for processing manual barcode inputs, quantities, phone numbers,
 * or currency fields typed on Arabic/Eastern keyboards.
 *
 * @param str - The input string containing potential Eastern Arabic numerals
 * @returns The string with Eastern Arabic numerals converted to English digits
 */
export const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
};
