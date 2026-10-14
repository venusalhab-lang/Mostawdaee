/**
 * One quoted CSV field. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
 * gets a leading apostrophe; plain numbers such as -12.5 are left as they are.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to CSV text with a BOM so Excel opens Arabic correctly. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
