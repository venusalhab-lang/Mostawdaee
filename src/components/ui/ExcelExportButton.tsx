import React from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

interface ExcelExportButtonProps {
  /** Rows, or a builder so large ledgers are only formatted when the user exports. */
  reportData: any[] | (() => any[]);
  fileName?: string;
  isRtl?: boolean;
}

export default function ExcelExportButton({ reportData: source, fileName, isRtl = true }: ExcelExportButtonProps) {
  
  const handleExport = () => {
    try {
      const reportData = typeof source === 'function' ? source() : source;
      if (!reportData || reportData.length === 0) {
        toast.info(isRtl ? 'لا توجد بيانات لتصديرها!' : 'No data available to export!');
        return;
      }

      // 1. Convert pure JSON list to a sheet structure
      const worksheet = XLSX.utils.json_to_sheet(reportData);

      // 2. Set Right-to-Left (RTL) mode so columns align naturally for Arabic
      if (isRtl) {
        worksheet['!dir'] = 'rtl';
      }

      // Calculate automated column widths for a clean look inside Excel
      const colWidths = Object.keys(reportData[0] || {}).map(key => {
        const maxLen = reportData.reduce((m, row) => Math.max(m, String(row[key] || '').length), key.length);
        return { wch: Math.min(Math.max(maxLen + 4, 12), 40) }; // bound within 12 - 40 chars
      });
      worksheet['!cols'] = colWidths;

      // 3. Construct a workbook and append the populated sheet
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, isRtl ? "سجل الحركة المركزية" : "Central Ledger");

      // 4. Generate & download file immediately via native browser bindings
      const finalName = `${fileName || (isRtl ? 'سجل_الخزنة' : 'vault_ledger')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, finalName);
      
      toast.success(isRtl ? 'صُدّر الملف بصيغة Excel.' : 'Excel workbook exported.');
    } catch (error) {
      console.error("Excel Export Error:", error);
      toast.error(isRtl ? 'فشل تصدير التقرير إلى Excel!' : 'An error occurred during Excel export!');
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      className="flex items-center gap-2 px-5 py-2.5 bg-[#0b1329] hover:bg-slate-900 border border-cyan-500/30 text-cyan-400 dark:bg-white/5 dark:hover:bg-white/10 dark:text-cyan-300 dark:border-cyan-400/20 text-xs font-bold rounded-xl transition-all shadow-sm active:scale-[0.98] cursor-pointer"
    >
      <Download size={14} className="text-cyan-400 animate-pulse" />
      <span>{isRtl ? 'تصدير تقرير Excel' : 'Export Excel Report'}</span>
    </button>
  );
}
