import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  ShoppingBag, 
  Activity, 
  Calendar, 
  ArrowUpRight, 
  RefreshCw, 
  Database,
  Layers,
  Sparkles,
  Info,
  Sliders,
  FolderOpen,
  ArrowRightLeft,
  Crown,
  AlertTriangle,
  Download,
  X,
  FileCheck
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar,
  Cell
} from 'recharts';
import { useFirebase } from './FirebaseProvider';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Invoice, Product, Currency } from '../types';
import { POS_CURRENCY_CODES, buildUsdUnitRates, convertMoney, currencyDecimals, formatMoney, readCachedLiveRates, roundMoney } from '../lib/exchangeRates';
import { lineUnitCost, saleInvoiceProfit, summarizeProfits } from '../lib/profits';

const sanitizeText = (text: string | null | undefined, fallbackId?: string): string => {
  if (!text) {
    return fallbackId ? `Standard POS Sale (${fallbackId})` : "Standard POS Sale";
  }
  
  const trimmed = text.trim();
  // Check if string contains corrupted encoding characters (e.g. þ, ÿ, ý, or binary non-ASCII artifacts)
  const isCorrupted = /[þÿý\u00de\u00fe\u00fd\u00ff\ufffd]/.test(trimmed);
  if (isCorrupted || trimmed === "" || trimmed === "null" || trimmed === "undefined") {
    if (fallbackId) {
      return `Standard POS Sale (${fallbackId})`;
    }
    return "Standard POS Sale";
  }

  const cleaned = trimmed.replace(/[þÿý\u00de\u00fe\u00fd\u00ff\ufffd]/g, "").trim();
  if (cleaned.length === 0) {
    return fallbackId ? `Standard POS Sale (${fallbackId})` : "Standard POS Sale";
  }

  return cleaned;
};

// Inline pure-JS SimplePDFBuilder to prevent compile/bundler issues in static builders

const safeAscii = (text: string | null | undefined, fallback: string = ""): string => {
  if (!text) return fallback;
  // Keep only basic printable ASCII characters (from space to tilde) to guarantee standard Helvetica compatibility
  const cleaned = text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
};

class SimplePDFBuilder {
  private pages: string[] = [];
  private currentStream: string = "";
  private currentY = 780;
  private leftMargin = 20;
  private pageWidth = 595.28;
  private contentWidth = 555.28; // pageWidth - 2 * leftMargin
  private selectedCurrency: string;
  private totals: { sales: number; cost: number; net: number; margin: number };
  private profitability: { hero: any; drain: any };
  private isAr: boolean;
  private convertPrice: (amount: number, fromCurrency: string, targetCurrency: string) => number;

  constructor(
    selectedCurrency: string,
    totals: { sales: number; cost: number; net: number; margin: number },
    profitability: { hero: any; drain: any },
    isAr: boolean,
    convertPriceFn: (amount: number, fromCurrency: string, targetCurrency: string) => number
  ) {
    this.selectedCurrency = selectedCurrency;
    this.totals = totals;
    this.profitability = profitability;
    this.isAr = isAr;
    this.convertPrice = convertPriceFn;
  }

  private formatAmount(amount: number): string {
    const digits = currencyDecimals(this.selectedCurrency);
    const num = amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${num} ${this.selectedCurrency}`;
  }

  private escapePdfText(text: string): string {
    if (!text) return "";
    return text.replace(/[\\()]/g, "\\$&");
  }

  private addText(text: string, x: number, y: number, fontSize: number, isBold: boolean = false, color: string = "0.06 0.09 0.16 rg") {
    const fontIdentifier = isBold ? '/F2' : '/F1';
    this.currentStream += `BT\n${color}\n${fontIdentifier} ${fontSize} Tf\n${x} ${y} Td\n(${this.escapePdfText(text)}) Tj\nET\n`;
  }

  private addRect(x: number, y: number, w: number, h: number, fillColor: string = "", strokeColor: string = "", lineWidth: number = 0.5) {
    let cmd = "";
    if (fillColor) {
      cmd += `${fillColor} rg\n`;
    }
    if (strokeColor) {
      cmd += `${strokeColor} RG\n${lineWidth} w\n`;
    }
    cmd += `${x} ${y} ${w} ${h} re\n`;
    if (fillColor && strokeColor) {
      cmd += "B\n";
    } else if (fillColor) {
      cmd += "f\n";
    } else if (strokeColor) {
      cmd += "S\n";
    }
    this.currentStream += cmd;
  }

  private addLine(x1: number, y1: number, x2: number, y2: number, strokeColor: string = "0.886 RG", lineWidth: number = 0.5) {
    this.currentStream += `${strokeColor}\n${lineWidth} w\n${x1} ${y1} m\n${x2} ${y2} l\nS\n`;
  }

  private startNewPage(drawTableHeader: boolean = true) {
    if (this.currentStream) {
      this.drawPageFooter();
      this.pages.push(this.currentStream);
    }
    this.currentStream = "";
    this.currentY = 780;

    if (drawTableHeader) {
      this.drawSubPageHeader();
    }
  }

  private drawPageFooter() {
    this.addLine(this.leftMargin, 30, this.pageWidth - this.leftMargin, 30, "0.886 RG", 0.5);
    this.addText(
      "Mostawdaee Accounting Ledger System  |  Operational Financial Performance Statement",
      this.leftMargin,
      20,
      7,
      false,
      "0.58 0.64 0.72 rg"
    );
  }

  private drawSubPageHeader() {
    this.addRect(this.leftMargin, this.currentY, this.contentWidth, 24, "0.145 0.388 0.922 rg");
    this.addText("OPERATIONAL FINANCIAL PERFORMANCE STATEMENT", this.leftMargin + 6, this.currentY + 14, 9, true, "1 1 1 rg");
    this.addText(`DATE: ${new Date().toLocaleDateString('en-US')}  |  CURRENCY: ${this.selectedCurrency}`, this.leftMargin + 6, this.currentY + 5, 7, false, "1 1 1 rg");
    this.currentY -= 15;

    this.addRect(this.leftMargin, this.currentY - 14, this.contentWidth, 14, "0.12 0.16 0.23 rg");
    const labelY = this.currentY - 10;
    this.addText("Date", 26, labelY, 7.5, true, "1 1 1 rg");
    this.addText("Invoice Ref & Customer Entity", 80, labelY, 7.5, true, "1 1 1 rg");
    this.addText("Type", 320, labelY, 7.5, true, "1 1 1 rg");
    this.addText("Currency", 370, labelY, 7.5, true, "1 1 1 rg");
    this.addText("Orig. Amount", 430, labelY, 7.5, true, "1 1 1 rg");
    this.addText(`Profit (${this.selectedCurrency})`, 505, labelY, 7.5, true, "1 1 1 rg");

    this.currentY -= 20;
  }

  public generate(filteredInvoices: any[]) {
    this.currentStream = "";
    
    this.addRect(this.leftMargin, this.currentY, this.contentWidth, 36, "0.145 0.388 0.922 rg");
    this.addText("OPERATIONAL FINANCIAL PERFORMANCE STATEMENT", this.leftMargin + 8, this.currentY + 22, 12, true, "1 1 1 rg");
    this.addText(`DATE GENERATED: ${new Date().toLocaleString('en-US')}  |  BASE CURRENCY: ${this.selectedCurrency}`, this.leftMargin + 8, this.currentY + 10, 8, false, "0.85 0.92 1 rg");
    
    this.currentY -= 50;

    this.addRect(this.leftMargin, this.currentY, this.contentWidth, 36, "0.97 0.98 0.99 rg", "0.886 RG", 0.5);
    const colWidth = this.contentWidth / 3;

    this.addText("GROSS ACCUMULATED REVENUE", this.leftMargin + 6, this.currentY + 24, 7, true, "0.28 0.33 0.41 rg");
    this.addText(this.formatAmount(this.totals.sales), this.leftMargin + 6, this.currentY + 10, 11, true, "0.145 0.388 0.922 rg");

    this.addText("COST OF GOODS SOLD", this.leftMargin + colWidth + 6, this.currentY + 24, 7, true, "0.28 0.33 0.41 rg");
    this.addText(this.formatAmount(this.totals.cost), this.leftMargin + colWidth + 6, this.currentY + 10, 11, true, "0.76 0.25 0.05 rg");

    this.addText("NET OPERATING MARGINS", this.leftMargin + (colWidth * 2) + 6, this.currentY + 24, 7, true, "0.28 0.33 0.41 rg");
    this.addText(`${this.formatAmount(this.totals.net)} (${this.totals.margin.toFixed(1)}%)`, this.leftMargin + (colWidth * 2) + 6, this.currentY + 10, 11, true, "0.02 0.59 0.41 rg");

    this.currentY -= 50;

    this.addText("PRODUCT PROFITABILITY INSIGHTS", this.leftMargin, this.currentY, 10, true, "0.12 0.16 0.23 rg");
    this.currentY -= 36;

    this.addRect(this.leftMargin, this.currentY, this.contentWidth, 32, "0.945 0.96 0.98 rg");
    
    const heroName = safeAscii(this.profitability.hero ? this.profitability.hero.name : 'No sales item registered for selected range', 'Standard Product');
    const heroProfit = this.profitability.hero ? this.formatAmount(this.profitability.hero.profit) : this.formatAmount(0);
    this.addText("Hero Product (Top Contributor):", this.leftMargin + 6, this.currentY + 22, 8, true, "0.06 0.09 0.16 rg");
    this.addText(`${heroName.substring(0, 80)} - Generated Contribution Profit of: ${heroProfit}`, this.leftMargin + 6, this.currentY + 14, 8, false, "0.06 0.09 0.16 rg");

    const drainName = safeAscii(this.profitability.drain ? this.profitability.drain.name : 'No underperforming items detected', 'Standard Product');
    const drainProfit = this.profitability.drain ? this.formatAmount(this.profitability.drain.profit) : this.formatAmount(0);
    this.addText("Underperformer Product (Lowest Margin/Drain):", this.leftMargin + 6, this.currentY + 6, 8, true, "0.06 0.09 0.16 rg");
    this.addText(`${drainName.substring(0, 80)} - Generated Contribution Profit of: ${drainProfit}`, this.leftMargin + 6, this.currentY - 2, 8, false, "0.06 0.09 0.16 rg");

    this.currentY -= 54;

    this.addText("TRANSACTION LEDGER & AUDIT TRAIL", this.leftMargin, this.currentY, 10, true, "0.06 0.09 0.16 rg");
    this.currentY -= 20;

    this.addRect(this.leftMargin, this.currentY, this.contentWidth, 14, "0.12 0.16 0.23 rg");
    const tblLabelY = this.currentY + 4;
    this.addText("Date", 26, tblLabelY, 7.5, true, "1 1 1 rg");
    this.addText("Invoice Ref & Customer Entity", 80, tblLabelY, 7.5, true, "1 1 1 rg");
    this.addText("Type", 320, tblLabelY, 7.5, true, "1 1 1 rg");
    this.addText("Currency", 370, tblLabelY, 7.5, true, "1 1 1 rg");
    this.addText("Orig. Amount", 430, tblLabelY, 7.5, true, "1 1 1 rg");
    this.addText(`Profit (${this.selectedCurrency})`, 505, tblLabelY, 7.5, true, "1 1 1 rg");

    this.currentY -= 14;

    filteredInvoices.forEach((inv, index) => {
      if (this.currentY < 60) {
        this.startNewPage(true);
      }

      const rowHeight = 16;
      this.currentY -= rowHeight;

      if (index % 2 === 0) {
        this.addRect(this.leftMargin, this.currentY, this.contentWidth, rowHeight, "0.98 0.985 0.99 rg");
      } else {
        this.addRect(this.leftMargin, this.currentY, this.contentWidth, rowHeight, "1 1 1 rg");
      }

      this.addLine(this.leftMargin, this.currentY, this.leftMargin + this.contentWidth, this.currentY, "0.95 0.96 0.97 RG", 0.5);

      const isSale = inv.type === 'sale';
      const dateStr = inv.date ? new Date(inv.date).toLocaleDateString('en-US') : '-';
      
      const invoiceCode = inv.invoiceNumber || 'POS-INV';
      const cleanCustomer = safeAscii(inv.customerName);
      const detailStr = cleanCustomer ? `${invoiceCode} (${cleanCustomer})` : invoiceCode;
      
      const currency = inv.currency || '-';
      const totalAmount = inv.totalAmount ?? 0;
      const profitRaw = inv.computedProfit ?? 0;
      const profitConverted = isSale ? this.convertPrice(profitRaw, currency, this.selectedCurrency) : 0;

      const cellTextY = this.currentY + 5;

      this.addText(dateStr, 26, cellTextY, 7.5, false, "0.15 0.20 0.25 rg");
      this.addText(detailStr.length > 50 ? `${detailStr.substring(0, 47)}...` : detailStr, 80, cellTextY, 7.5, false, "0.15 0.20 0.25 rg");
      
      if (isSale) {
        this.addText("Sale", 320, cellTextY, 7.5, true, "0.02 0.59 0.41 rg");
      } else {
        this.addText("Purchase", 320, cellTextY, 7.5, true, "0.85 0.18 0.18 rg");
      }

      this.addText(currency, 370, cellTextY, 7.5, false, "0.15 0.20 0.25 rg");
      this.addText(totalAmount.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }), 430, cellTextY, 7.5, false, "0.15 0.20 0.25 rg");
      
      if (isSale) {
        this.addText(this.formatAmount(profitConverted), 505, cellTextY, 7.5, true, "0.02 0.59 0.41 rg");
      } else {
        this.addText("-", 505, cellTextY, 7.5, false, "0.4 0.45 0.5 rg");
      }
    });

    this.drawPageFooter();
    this.pages.push(this.currentStream);
  }

  public build(): Uint8Array {
    let pdfText = "%PDF-1.4\n";
    const encoder = new TextEncoder();
    
    const rootObjects: string[] = [
      `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
      ``, 
      `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
      `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`
    ];

    const pageCount = this.pages.length;
    const pageObjIds: number[] = [];
    
    let nextObjId = 5;
    const pageObjects: string[] = [];

    for (let i = 0; i < pageCount; i++) {
      const pageObjId = nextObjId;
      const contentObjId = nextObjId + 1;
      pageObjIds.push(pageObjId);

      const pageObjStr = `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`;
      
      const streamText = this.pages[i];
      const streamBytes = encoder.encode(streamText);
      const contentObjStr = `${contentObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamText}\nendstream\nendobj\n`;

      pageObjects.push(pageObjStr);
      pageObjects.push(contentObjStr);

      nextObjId += 2;
    }

    rootObjects[1] = `2 0 obj\n<< /Type /Pages /Kids [ ${pageObjIds.map(id => `${id} 0 R`).join(" ")} ] /Count ${pageCount} >>\nendobj\n`;

    const allObjectsText: string[] = [
      rootObjects[0],
      rootObjects[1],
      rootObjects[2],
      rootObjects[3],
      ...pageObjects
    ];

    const totalObjectsCount = allObjectsText.length;
    let byteLength = encoder.encode(pdfText).length;
    const finalOffsets: number[] = [];

    const objBytesArrays: Uint8Array[] = [];
    for (let i = 0; i < totalObjectsCount; i++) {
      finalOffsets[i] = byteLength;
      const objBytes = encoder.encode(allObjectsText[i]);
      objBytesArrays.push(objBytes);
      byteLength += objBytes.length;
    }

    const xrefOffset = byteLength;
    let xrefText = "xref\n";
    xrefText += `0 ${totalObjectsCount + 1}\n`;
    xrefText += "0000000000 65535 f \n";
    for (let i = 0; i < totalObjectsCount; i++) {
      const offsetStr = String(finalOffsets[i]).padStart(10, '0');
      xrefText += `${offsetStr} 00000 n \n`;
    }
    
    xrefText += "trailer\n";
    xrefText += `<< /Size ${totalObjectsCount + 1} /Root 1 0 R >>\n`;
    xrefText += "startxref\n";
    xrefText += `${xrefOffset}\n`;
    xrefText += "%%EOF\n";

    const xrefBytes = encoder.encode(xrefText);

    const pdfHeaderBytes = encoder.encode(pdfText);
    const totalLength = pdfHeaderBytes.length + objBytesArrays.reduce((sum, arr) => sum + arr.length, 0) + xrefBytes.length;

    const result = new Uint8Array(totalLength);
    let offset = 0;
    result.set(pdfHeaderBytes, offset);
    offset += pdfHeaderBytes.length;

    for (const arr of objBytesArrays) {
      result.set(arr, offset);
      offset += arr.length;
    }

    result.set(xrefBytes, offset);

    return result;
  }
}

interface ProfitsDashboardProps {
  language?: 'ar' | 'en';
  currency?: string; 
  onClose?: () => void;
}

interface ProfitInvoice {
  id: string;
  invoiceNumber: string;
  date: number; // milliseconds
  customerName: string;
  type: 'sale' | 'purchase';
  currency: string;
  subtotal: number;
  totalAmount: number;
  computedCost: number; 
  computedProfit: number; 
  unknownCostLines: number;
}

export default function ProfitsDashboard({ language = 'en', currency = 'JOD', onClose }: ProfitsDashboardProps) {
  // Real-time Firestore synchronized ledger collections
  const { invoices = [], products = [], loading: firebaseLoading, settings } = useFirebase();

  // Loading, Local Refresh and Database Sync states (Starting clean and empty)
  
  // Date Filters (Today, This Week, This Month, All Time)
  const [timeRange, setTimeRange] = useState<'today' | 'weekly' | 'monthly' | 'all'>('monthly');
  
  // USD, ILS, JOD Selector is fully operational 
  const [selectedCurrency, setSelectedCurrency] = useState<string>(currency || 'JOD');

  // Multi-currency exchange rate tables relative to base USD (1.0)
  const exchangeRates = useMemo(
    () => buildUsdUnitRates(settings, readCachedLiveRates()),
    [settings],
  );

  // Translate according to system language
  const isAr = language === 'ar';

  const t = {
    title: isAr ? "لوحة أرباح العمليات التشغيلية" : "OPERATIONAL PROFITS DASHBOARD",
    subtitle: isAr ? "التنبؤ المالي وسجل الأداء الفعلي في الوقت الحقيقي" : "FINANCIAL FORECASTING & REAL-TIME PERFORMANCE LEDGER",
    filtersLabel: isAr ? "التصفيات:" : "Filters:",
    today: isAr ? "اليوم" : "Today",
    thisWeek: isAr ? "هذا الأسبوع" : "This Week",
    thisMonth: isAr ? "هذا الشهر" : "This Month",
    allHistory: isAr ? "كل السجلات" : "All History",
    currencySwitched: isAr ? "تم تحويل عرض العملة النشط إلى:" : "Active display currency set to:",
    pdfExport: isAr ? "تصدير كشف PDF" : "PDF Export",
    csvExport: isAr ? "تصدير ملف CSV" : "Export CSV",
    loadingRecords: isAr ? "جاري استرداد السجلات والبيانات المالية الآمنة..." : "Retrieving secure financial records...",
    noDataTitle: isAr ? "لا توجد سجلات معاملات مسجلة" : "No Transaction History Recorded",
    noDataDesc: isAr ? "لم يتم العثور على أي مبيعات، فواتير أو معاملات شراء مطابقة من قاعدة البيانات للفتوة المحددة." : "No matching sales, invoices, or purchase transactions were retrieved from either database during the selected date interval.",
    grossRevenue: isAr ? "إجمالي الإيرادات المتراكمة" : "GROSS ACCUMULATED REVENUE",
    salesCumulativeDesc: isAr ? "صافي المبيعات بعد الخصم وبدون ضريبة القيمة المضافة" : "Net sales after discount, excluding VAT",
    cogs: isAr ? "تكلفة البضائع المباعة (COGS)" : "COST OF GOODS SOLD",
    acqCostDesc: isAr ? "تكلفة الأصناف المباعة بسعر تكلفتها وقت البيع" : "Cost of the items sold, at their cost when sold",
    netMargin: isAr ? "صافي هوامش الأرباح التشغيلية" : "NET OPERATING MARGINS",
    marginLabel: isAr ? "هامش" : "Margin",
    netOpsMarginDesc: isAr ? "المبيعات ناقص تكلفة الأصناف المباعة (قبل المصاريف)" : "Sales minus cost of goods sold (before expenses)",
    chartTitle: isAr ? "منحنى الهامش التشغيلي (صافي الأرباح / الزمن)" : "Net Operational Margin Curve (Profits / Time)",
    last15: isAr ? "آخر 15 معاملة مالية" : "Last 15 Transactions",
    noTemporalVariation: isAr ? "لا توجد معاملات كافية لرسم المنحنى حاليًا" : "Not enough temporal variation to render progress curve",
    prodInsights: isAr ? "تحليلات ربحية المنتجات" : "PRODUCT PROFITABILITY INSIGHTS",
    heroChampion: isAr ? "المنتج البطل (الأعلى أداءً)" : "HERO CHAMPION",
    topContribution: isAr ? "المساهم الأعلى في صافي الأرباح" : "Top Contribution",
    cumulativeProfitLabel: isAr ? "الأرباح التراكمية المسجلة:" : "Cumulative Profit:",
    noSalesItem: isAr ? "لا توجد معاملات بيع لعرض هذا التحليل" : "No sales item logged to display analysis",
    lowestContributor: isAr ? "المنتج الأقل مساهمة (الأداء الأضعف)" : "LOWEST CONTRIBUTOR",
    underperformer: isAr ? "أداء منخفض الهامش" : "Underperformer",
    noUnderperformingData: isAr ? "لا توجد بيانات كافية لتحليل الضعف" : "No underperforming data generated",
    contributionsRanking: isAr ? "قائمة رتبة مساهمات المنتجات بالأرباح" : "Products contributions ranking list",
    ledgerTitle: isAr ? "دفتر الأستاذ ومسار التدقيق المالي بالكامل" : "TRANSACTION LEDGER & AUDIT TRAIL",
    ledgerRowsCount: isAr ? "سجلات التاريخ المالي والعمليات" : "historical statements records",
    date: isAr ? "التاريخ" : "Date",
    invRef: isAr ? "رقم الفاتورة" : "Invoice Reference",
    clientSupplier: isAr ? "العميل / المورد المسؤول" : "Client / Supplier Entity",
    type: isAr ? "النوع" : "Type",
    currency: isAr ? "العملة" : "Currency",
    originalValue: isAr ? "القيمة الأصلية" : "Original Value",
    acqCost: isAr ? "تكلفة القطع" : "Acquisition Cost",
    netMarginSelected: isAr ? "صافي الهامش" : "Net Margin",
    saleType: isAr ? "بيع" : "Sale",
    purchaseType: isAr ? "شراء" : "Purchase",
    toastNoDataExport: isAr ? "لا توجد بيانات للمعاملات للتصدير حاليًا!" : "No data found with the current filter settings to export!",
    toastCsvSuccess: isAr ? "تم تصدير سجل المعاملات بتنسيق Excel بنجاح!" : "Excel-compatible transaction log successfully exported!",
    toastPdfSuccess: isAr ? "تم تصدير مستند الأرباح المعتمد بنجاح!" : "Pristine financial PDF successfully compiled!"
  };

  // Dynamic values conversion
  const convertPrice = (amount: number, fromCurrency: string, targetCurrency: string): number =>
    convertMoney(amount, (fromCurrency || 'USD').toUpperCase(), (targetCurrency || 'USD').toUpperCase(), exchangeRates);

  const showMoney = (amount: number, code: string) =>
    formatMoney(amount, code, isAr ? 'ar' : 'en-US');


  const defaultCurrency = settings?.currency || 'JOD';
  const productsById = useMemo(() => new Map((products || []).map((p: Product) => [p.id, p])), [products]);

  const mergedInvoices = useMemo<ProfitInvoice[]>(() => {
    return (invoices || []).map((inv: Invoice) => {
      const isSale = inv.type === 'sale';
      const total = Number(inv.totalAmount) || 0;
      const p = isSale ? saleInvoiceProfit(inv, productsById, exchangeRates, defaultCurrency) : null;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber || '',
        date: inv.date || 0,
        customerName: inv.customerName || inv.supplierName || '',
        type: inv.type || 'sale',
        currency: inv.currency || defaultCurrency,
        subtotal: p ? p.revenue : total,
        totalAmount: total,
        computedCost: p ? p.cost : total,
        computedProfit: p ? p.profit : 0,
        unknownCostLines: p ? p.unknownCostLines : 0,
      };
    });
  }, [invoices, productsById, exchangeRates, defaultCurrency]);

  // DATE FILTERING LOGIC
  const filteredInvoices = useMemo<ProfitInvoice[]>(() => {
    const now = new Date();
    
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(now.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(now.getDate() - 30);
    startOfMonth.setHours(0, 0, 0, 0);

    return mergedInvoices.filter(inv => {
      const time = inv.date;

      if (timeRange === 'today') {
        return time >= startOfToday.getTime();
      }
      if (timeRange === 'weekly') {
        return time >= startOfWeek.getTime();
      }
      if (timeRange === 'monthly') {
        return time >= startOfMonth.getTime();
      }
      return true; // 'all'
    });
  }, [mergedInvoices, timeRange]);

  const totals = useMemo(() => {
    const ids = new Set(filteredInvoices.map((f) => f.id));
    const sum = summarizeProfits((invoices || []).filter((inv) => ids.has(inv.id)), products || [], exchangeRates, selectedCurrency, defaultCurrency);
    return { sales: sum.revenue, cost: sum.cost, net: sum.profit, margin: sum.margin, unknownCostLines: sum.unknownCostLines, purchases: sum.purchases };
  }, [filteredInvoices, invoices, products, selectedCurrency, exchangeRates, defaultCurrency]);

  // PRODUCT PROFITABILITY MATRIX
  const productProfitability = useMemo(() => {
    const aggregates: Record<string, { 
      name: string; 
      qty: number; 
      revenue: number; 
      cost: number; 
      profit: number;
    }> = {};

    const filteredIds = new Set(filteredInvoices.map(f => f.id));
    const activeRawInvoices = (invoices || []).filter(inv => filteredIds.has(inv.id));

    activeRawInvoices.forEach(inv => {
      if (inv.type !== 'sale') return;
      const invCurrency = inv.currency || 'JOD';

      if (inv.items && Array.isArray(inv.items)) {
        inv.items.forEach((item: any) => {
          const qty = item.quantity || 1;
          const productId = item.productId || 'unknown';
          const description = item.description || item.name || 'Unknown Product';

          const product = (products || []).find(
            (p: Product) => p.id === productId || p.name === description
          );
          const rawDisplayName = product ? product.name : description;
          const displayName = sanitizeText(rawDisplayName, productId !== 'unknown' ? productId : undefined);
          const key = product ? product.id : displayName;

          const itemCost = lineUnitCost(item, invCurrency, product, exchangeRates, defaultCurrency) ?? 0;

          const totalItemRevenueRaw = (item.unitPrice || 0) * qty;
          const totalItemCostRaw = itemCost * qty;
          const totalItemProfitRaw = totalItemRevenueRaw - totalItemCostRaw;

          const revConverted = convertPrice(totalItemRevenueRaw, invCurrency, selectedCurrency);
          const costConverted = convertPrice(totalItemCostRaw, invCurrency, selectedCurrency);
          const profitConverted = convertPrice(totalItemProfitRaw, invCurrency, selectedCurrency);

          if (!aggregates[key]) {
            aggregates[key] = {
              name: displayName,
              qty: 0,
              revenue: 0,
              cost: 0,
              profit: 0,
            };
          }

          aggregates[key].qty += qty;
          aggregates[key].revenue += revConverted;
          aggregates[key].cost += costConverted;
          aggregates[key].profit += profitConverted;
        });
      }
    });

    const list = Object.values(aggregates);
    if (!list || list.length === 0) {
      return { hero: null, drain: null, list: [] };
    }

    try {
      const hero = list.reduce((best, cur) => {
        if (!best) return cur;
        if (!cur) return best;
        const bestProfit = best.profit ?? 0;
        const curProfit = cur.profit ?? 0;
        return curProfit > bestProfit ? cur : best;
      }, list[0]);

      const drain = list.reduce((worst, cur) => {
        if (!worst) return cur;
        if (!cur) return worst;
        const worstProfit = worst.profit ?? 0;
        const curProfit = cur.profit ?? 0;
        return curProfit < worstProfit ? cur : worst;
      }, list[0]);

      return {
        hero: hero && hero.profit > 0 ? hero : null,
        drain: drain && hero && drain.profit <= hero.profit ? drain : null,
        list: list.sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
      };
    } catch (e) {
      console.error("Error analyzing profitability matrix:", e);
      return { hero: null, drain: null, list: [] };
    }
  }, [filteredInvoices, invoices, products, selectedCurrency, exchangeRates]);

  // AREA CHART TIMECOURSE GENERATION
  const chartData = useMemo(() => {
    const days: Record<string, number> = {};
    const sortedInvs = [...filteredInvoices].sort((a, b) => a.date - b.date);

    sortedInvs.slice(-15).forEach(inv => {
      const dayLabel = new Date(inv.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      const convertedProfit = inv.type === 'sale' ? convertPrice(inv.computedProfit, inv.currency, selectedCurrency) : 0;

      days[dayLabel] = (days[dayLabel] || 0) + convertedProfit;
    });

    return Object.entries(days).map(([day, profit]) => ({
      day,
      Profit: roundMoney(profit, selectedCurrency)
    }));
  }, [filteredInvoices, selectedCurrency, exchangeRates]);

  // STYLISH EXCEL / CSV JOURNAL DOWNLOADER
  const handleExportCSV = () => {
    if (filteredInvoices.length === 0) {
      toast.error(t.toastNoDataExport || 'No data found with the current filter settings to export!');
      return;
    }

    const headers = ['Date', 'Invoice ID', 'Client/Supplier', 'Transaction Type', 'Original Currency', `Amount (${selectedCurrency})`, `Estimated Cost (${selectedCurrency})`, `Net Profit (${selectedCurrency})` ];

    const rows = filteredInvoices.map(inv => {
      const isSale = inv.type === 'sale';
      const convertedTotal = convertPrice(inv.totalAmount, inv.currency, selectedCurrency);
      const convertedCost = convertPrice(inv.computedCost, inv.currency, selectedCurrency);
      const convertedProfit = isSale ? convertPrice(inv.computedProfit, inv.currency, selectedCurrency) : 0;
      
      const dateStr = new Date(inv.date).toLocaleDateString('en-US');
      const typeStr = isSale ? 'Sale / Income' : 'Purchase / Operational Cost';
      
      const escapeCsv = (val: any) => {
        const str = String(val === null || val === undefined ? '' : val);
        return `"${str.replace(/"/g, '""')}"`;
      };

      return [
        escapeCsv(dateStr),
        escapeCsv(inv.invoiceNumber),
        escapeCsv(sanitizeText(inv.customerName, inv.invoiceNumber)),
        escapeCsv(typeStr),
        escapeCsv(inv.currency),
        showMoney(convertedTotal, selectedCurrency),
        showMoney(convertedCost, selectedCurrency),
        showMoney(convertedProfit, selectedCurrency)
      ].join(',');
    });

    const csvContent = "\ufeff" + [
      `Operational Profits & Financial Insights Report`,
      `Export Timestamp: ${new Date().toLocaleString('en-US')}`,
      `Filter Interval: ${timeRange.toUpperCase()}`,
      `Unified Currency: ${selectedCurrency}`,
      `Gross Cumulative Sales: ${showMoney(totals.sales, selectedCurrency)}`,
      `Operational Inventory Costs (COGS): ${showMoney(totals.cost, selectedCurrency)}`,
      `Net Cumulative Profit Margin: ${showMoney(totals.net, selectedCurrency)} (${totals.margin.toFixed(1)}%)`,
      "",
      headers.join(','),
      ...rows
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Operational_Performance_Statement_${selectedCurrency}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t.toastCsvSuccess || 'Excel-compatible transaction log successfully exported!');
  };

  // STRICTLY ENGLISH PDF EXPORT FUNCTION (COMPATIBILITY & NO ARABIC CHAR HOLES)
  const handleExportPDF = () => {
    if (filteredInvoices.length === 0) {
      toast.error(t.toastNoDataExport || "No data with active filters to export!");
      return;
    }

    try {
      const builder = new SimplePDFBuilder(selectedCurrency, totals, productProfitability, isAr, convertPrice);
      builder.generate(filteredInvoices);
      const pdfBytes = builder.build();
      
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Corporate_Financial_Statement_${selectedCurrency}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      toast.success(t.toastPdfSuccess || 'Pristine financial PDF successfully compiled!');
    } catch (error) {
      console.error("PDF generation failure:", error);
      toast.error("Failed to generate PDF. Standard CSV format was exported as fallback.");
      handleExportCSV();
    }
  };



  const isDataLoading = firebaseLoading;

  return (
    <div 
      className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-800 font-sans p-4 sm:p-6 md:p-8"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Container Frame */}
      <div className="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden">
        
        {/* Dynamic Nav-Header */}
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 rounded-lg text-white shadow-md shadow-blue-500/20">
              <TrendingUp className="w-5 h-5 text-cyan-200 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight uppercase">{t.title}</h1>
              <p className="text-xs text-slate-400 font-mono tracking-wider">{t.subtitle}</p>
            </div>
          </div>
          {onClose && (
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-transform hover:scale-105"
              title={isAr ? "إغلاق لوحة التحكم" : "Close Dashboard"} aria-label={isAr ? "إغلاق لوحة التحكم" : "Close Dashboard"}
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Dashboard Tools Bar (Filters & Interactive Buttons) */}
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Section 1: Dynamic Date Range Quick Filters (Interactive Buttons) */}
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-slate-400 mx-1" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mx-2">{t.filtersLabel}</span>
            <div className="bg-white p-1 rounded-lg border border-slate-200 shadow-sm flex items-center gap-1">
              {[
                { key: 'today', label: t.today },
                { key: 'weekly', label: t.thisWeek },
                { key: 'monthly', label: t.thisMonth },
                { key: 'all', label: t.allHistory }
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setTimeRange(item.key as any)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    timeRange === item.key 
                      ? 'bg-blue-600 text-white shadow-sm font-semibold' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Section 2: Currency Switcher & Global Action Tools */}
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Currency Selector Buttons with math conversions */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
              {POS_CURRENCY_CODES.map(curr => (
                <button
                  key={curr}
                  onClick={() => {
                    setSelectedCurrency(curr);
                    toast.info(`${t.currencySwitched} ${curr}`);
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    selectedCurrency === curr 
                      ? 'bg-blue-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {curr}
                </button>
              ))}
            </div>




            {/* Download Report Button */}
            <button
              onClick={handleExportPDF}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-blue-500/10 transition-all hover:-translate-y-0.5"
            >
              <Download className="w-4 h-4 text-cyan-200" />
              {t.pdfExport}
            </button>

            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg flex items-center gap-2 shadow-sm transition-all"
            >
              <FileCheck className="w-4 h-4" />
              {t.csvExport}
            </button>
          </div>
        </div>

        {/* Outer body */}
        <div className="p-6 space-y-6">
          
          {isDataLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-4" />
              <p className="text-sm font-medium text-slate-500">{t.loadingRecords}</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200 p-8">
              <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-base font-bold text-slate-700">{t.noDataTitle}</h3>
              <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
                {t.noDataDesc}
              </p>
            </div>
          ) : (
            <>
              {(totals.unknownCostLines > 0 || totals.purchases > 0) && (
                <div className="space-y-2">
                  {totals.unknownCostLines > 0 && (
                    <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                      {isAr
                        ? `${totals.unknownCostLines} سطر مبيع بلا سعر تكلفة مسجّل، فحُسبت تكلفته صفراً والربح المعروض أعلى من الحقيقي. أضف سعر التكلفة للأصناف من شاشة المخزون.`
                        : `${totals.unknownCostLines} sold line(s) have no cost recorded, so they count as zero cost and profit is overstated. Add unit costs in Inventory.`}
                    </p>
                  )}
                  {totals.purchases > 0 && (
                    <p className="text-xs text-slate-500">
                      {isAr ? 'مشتريات الفترة (لا تُخصم من الربح لأنها تدخل المخزون):' : 'Purchases in this period (not deducted from profit; they go into stock):'}{' '}
                      <span className="font-bold text-slate-700">{showMoney(totals.purchases, selectedCurrency)}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Premium Light-Theme KPI Scoreboard Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Scoreboard Card 1: Gross revenue */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex items-start justify-between"
                >
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">{t.grossRevenue}</span>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {showMoney(totals.sales, selectedCurrency)}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {t.salesCumulativeDesc}
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                    <DollarSign className="w-5 h-5 text-cyan-600" />
                  </div>
                </motion.div>

                {/* Scoreboard Card 2: COGS */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex items-start justify-between"
                >
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">{t.cogs}</span>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {showMoney(totals.cost, selectedCurrency)}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {t.acqCostDesc}
                    </p>
                  </div>
                  <div className="p-3 bg-rose-50 text-rose-600 rounded-lg">
                    <Layers className="w-5 h-5 text-rose-500" />
                  </div>
                </motion.div>

                {/* Scoreboard Card 3: Net margin */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex items-start justify-between"
                >
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">{t.netMargin}</span>
                    <h2 className={`text-2xl font-black tracking-tight ${totals.net < 0 ? 'text-rose-600' : 'text-blue-600'}`}>
                      {showMoney(totals.net, selectedCurrency)}
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-sans text-xs font-bold px-2 py-0.5 rounded ${totals.net < 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {t.marginLabel} {totals.margin.toFixed(1)}%
                      </span>
                      <span className="text-xs text-slate-400">{t.netOpsMarginDesc}</span>
                    </div>
                  </div>
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Activity className="w-5 h-5" />
                  </div>
                </motion.div>

              </div>

              {/* Core Analytics: Chart Grid & Product profitability */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Linear Performance Plot */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{t.chartTitle}</h3>
                    </div>
                    <span className="text-xs font-semibold text-blue-500 bg-blue-50 px-2.5 py-1 rounded-full">
                      {t.last15}
                    </span>
                  </div>
                  <div className="h-64 w-full">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: isAr ? 10 : -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} tickLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} orientation={isAr ? "right" : "left"} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e3e5' }}
                            labelStyle={{ fontWeight: 'bold', color: '#1e293b', fontSize: '11px' }}
                            itemStyle={{ color: '#2563eb', fontSize: '11px' }}
                          />
                          <Area type="monotone" dataKey="Profit" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                        {t.noTemporalVariation}
                      </div>
                    )}
                  </div>
                </div>

                {/* PRODUCT PROFITABILITY INSIGHTS (HERO & UNDERPERFORMER SPECIFIED IN REQUEST 3) */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                  <div className="pb-3 border-b border-slate-100 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-500 animate-bounce" />
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{t.prodInsights}</h3>
                  </div>

                  <div className="space-y-3.5">
                    
                    {/* Hero product item */}
                    <div className="bg-teal-50/50 border border-teal-100 rounded-xl p-4 space-y-1.5 text-right">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-teal-800 uppercase tracking-wider bg-teal-100 px-2 py-0.5 rounded">{t.heroChampion}</span>
                        <div className="flex items-center gap-1 text-teal-600">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold">{t.topContribution}</span>
                        </div>
                      </div>
                      {productProfitability.hero ? (
                        <>
                          <h4 className="font-semibold text-slate-900 text-sm truncate text-left">{productProfitability.hero.name}</h4>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-slate-500">{t.cumulativeProfitLabel}</span>
                            <span className="text-sm font-black text-teal-700">
                              {showMoney(productProfitability.hero.profit, selectedCurrency)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 italic text-left">{t.noSalesItem}</p>
                      )}
                    </div>

                    {/* Underperforming item */}
                    <div className="bg-orange-50/50 border border-orange-100 rounded-xl p-4 space-y-1.5 text-right">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-orange-950 uppercase tracking-wider bg-orange-100 px-2 py-0.5 rounded text-orange-800">{t.lowestContributor}</span>
                        <div className="flex items-center gap-1 text-orange-600">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold">{t.underperformer}</span>
                        </div>
                      </div>
                      {productProfitability.drain ? (
                        <>
                          <h4 className="font-semibold text-slate-900 text-sm truncate text-left">{productProfitability.drain.name}</h4>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-slate-500">{t.cumulativeProfitLabel}</span>
                            <span className="text-sm font-black text-orange-700">
                              {showMoney(productProfitability.drain.profit, selectedCurrency)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 italic text-left">{t.noUnderperformingData}</p>
                      )}
                    </div>

                    {/* Quick ranking overview */}
                    <div className="pt-2 text-right">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block pb-2">{t.contributionsRanking}</span>
                      <div className="max-h-24 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-slate-200 text-left">
                        {productProfitability.list.slice(0, 5).map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs py-1 px-1.5 hover:bg-slate-50 rounded">
                            <span className="text-slate-600 font-medium truncate max-w-xs">{idx + 1}. {item.name}</span>
                            <span className="text-slate-800 font-bold">
                              {showMoney(item.profit, selectedCurrency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>

              </div>

              {/* TABLE REVERSION TO ENGLISH (REQUIREMENT 3: Standard clean table columns in English) */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-slate-500" />
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{t.ledgerTitle}</h3>
                  </div>
                  <span className="text-xs text-slate-500 font-semibold">
                    {t.ledgerRowsCount}: {filteredInvoices.length}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        <th className="py-3.5 px-5">{t.date}</th>
                        <th className="py-3.5 px-5">{t.invRef}</th>
                        <th className="py-3.5 px-5">{t.clientSupplier}</th>
                        <th className="py-3.5 px-5 text-center">{t.type}</th>
                        <th className="py-3.5 px-5">{t.currency}</th>
                        <th className="py-3.5 px-5 text-right">{t.originalValue}</th>
                        <th className="py-3.5 px-5 text-right">{t.acqCost}</th>
                        <th className="py-3.5 px-5 text-right">{t.netMarginSelected} ({selectedCurrency})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-mono">
                      {filteredInvoices.map((inv, index) => {
                        const isSale = inv.type === 'sale';
                        const profitValConverted = isSale ? convertPrice(inv.computedProfit, inv.currency, selectedCurrency) : 0;
                        const costPriceConverted = convertPrice(inv.computedCost, inv.currency, selectedCurrency);
                        const totalAmountConverted = convertPrice(inv.totalAmount, inv.currency, selectedCurrency);

                        return (
                          <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-5 text-slate-600 font-medium">
                              {new Date(inv.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-3 px-5 font-bold text-slate-900">{inv.invoiceNumber}</td>
                            <td className="py-3 px-5 text-slate-700">{sanitizeText(inv.customerName, inv.invoiceNumber)}</td>
                            <td className="py-3 px-5 text-center">
                              {isSale ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                                  {t.saleType}
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wide">
                                  {t.purchaseType}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-5 font-bold text-slate-400">{inv.currency}</td>
                            <td className="py-3 px-5 text-right font-black text-slate-700">
                              {showMoney(inv.totalAmount, inv.currency || selectedCurrency)}
                            </td>
                            <td className="py-3 px-5 text-right text-slate-500">
                              {showMoney(costPriceConverted, selectedCurrency)}
                            </td>
                            <td className="py-3 px-5 text-right">
                              {isSale ? (
                                <span className="font-extrabold text-blue-600">
                                  + {showMoney(profitValConverted, selectedCurrency)}
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              </div>
            </>
          )}

        </div>

      </div>
    </div>
  );
}
