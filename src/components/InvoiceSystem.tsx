import { consumeInvoiceNumber } from '../lib/invoiceNumber';
import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations } from '../translations';
import { Language, Invoice, InvoiceItem, Product, Currency } from '../types';
import { useFirebase } from './FirebaseProvider';
import { usePreferredCurrency } from './CurrencyContext';
import { toast } from 'sonner';
import { 
  FileText, 
  Plus, 
  Printer, 
  Search, 
  ChevronRight, 
  PlusCircle, 
  Trash2,
  Download,
  Building,
  User,
  Calendar,
  CheckCircle2,
  Share2,
  QrCode,
  TrendingUp
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import Logo from './Logo';

interface InvoiceSystemProps {
  language: Language;
  initialView?: 'list' | 'create';
}

export default function InvoiceSystem({ language, initialView = 'list' }: InvoiceSystemProps) {
  const t = translations[language];
  const isRtl = language === 'ar';
  const { products, invoices, saveInvoice, settings, user } = useFirebase();
  const { formatPrice: globalFormatPrice, preferredCurrency } = usePreferredCurrency();
  const activeCurrency = preferredCurrency === 'DEFAULT' ? (settings?.currency || 'JOD') : preferredCurrency;

  const formatCurrency = (val: number, customCurrency?: string) => {
    const cur = customCurrency || settings?.currency || 'JOD';
    const symbol = cur === 'JOD' ? 'د.أ' : cur === 'USD' ? '$' : '₪';
    return globalFormatPrice(val, symbol);
  };
  const printRef = useRef<HTMLDivElement>(null);
  
  const [view, setView] = useState<'list' | 'create' | 'view'>(initialView);
  const [invoiceType, setInvoiceType] = useState<'sale' | 'purchase'>('sale');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [invSearchTerm, setInvSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Invoice; direction: 'desc' | 'asc' }>({ key: 'date', direction: 'desc' });
  
  const handleSort = (key: keyof Invoice) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedInvoices = React.useMemo(() => {
    let result = invoices.filter(inv => {
      // Direct dynamic currency match
      if (inv.currency !== activeCurrency) return false;

      const search = invSearchTerm.toLowerCase();
      return (
        inv.invoiceNumber.toLowerCase().includes(search) ||
        (inv.customerName && inv.customerName.toLowerCase().includes(search)) ||
        (inv.supplierName && inv.supplierName.toLowerCase().includes(search))
      );
    });
    
    result.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal! < bVal!) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal! > bVal!) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [invoices, invSearchTerm, sortConfig, activeCurrency]);

  // Create Invoice State
  const [customerName, setCustomerName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [newInvoiceSuccess, setNewInvoiceSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invoiceCurrency, setInvoiceCurrency] = useState<Currency>(settings?.currency || 'JOD');

  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  // Dynamic Export Helpers for Accounting Use
  const exportInvoicesToCSV = () => {
    try {
      const headers = isRtl
        ? ['رقم الفاتورة', 'النوع', 'العميل / المورد', 'التاريخ والوقت', 'المجموع الكلي', 'العملة']
        : ['Invoice Number', 'Type', 'Client / Supplier', 'Date & Time', 'Grand Total', 'Currency'];

      const rows = sortedInvoices.map(inv => {
        const typeStr = inv.type === 'sale' 
          ? (isRtl ? 'مبيعات' : 'Sale') 
          : (isRtl ? 'مشتريات' : 'Purchase');
        const entityName = inv.customerName || inv.supplierName || (isRtl ? 'زبون عام' : 'General Customer');
        const formattedDate = new Date(inv.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US');

        return [
          inv.invoiceNumber,
          typeStr,
          entityName,
          formattedDate,
          inv.totalAmount.toFixed(2),
          inv.currency || activeCurrency
        ];
      });

      const escapeCsvField = (field: string) => {
        const stringified = (field || '').replace(/"/g, '""');
        return `"${stringified}"`;
      };

      const csvContent = "\uFEFF" + [
        headers.map(escapeCsvField).join(','),
        ...rows.map(row => row.map(escapeCsvField).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Mostawdaee_Invoices_Export_${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(isRtl ? 'تم تصدير الفواتير كملف Excel / CSV بنجاح! 📊' : 'Invoices exported as Excel / CSV successfully!');
    } catch (error) {
      console.error(error);
      toast.error(isRtl ? 'فشل تصدير الفواتير' : 'Failed to export invoices');
    }
  };

  const exportInvoicesToPDF = () => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0px';
      iframe.style.height = '0px';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) return;

      let rowsHtml = '';
      let totalSalesSum = 0;
      let totalPurchasesSum = 0;

      sortedInvoices.forEach((inv, idx) => {
        const typeStr = inv.type === 'sale' 
          ? (isRtl ? 'مبيعات' : 'Sale') 
          : (isRtl ? 'مشتريات' : 'Purchase');
        
        if (inv.type === 'sale') {
          totalSalesSum += inv.totalAmount;
        } else {
          totalPurchasesSum += inv.totalAmount;
        }

        const typeColor = inv.type === 'sale' ? 'color: #4f46e5; font-weight: bold;' : 'color: #10b981; font-weight: bold;';
        const entityName = inv.customerName || inv.supplierName || (isRtl ? 'زبون نقدي عام' : 'Direct Customer');
        const formattedDate = new Date(inv.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US');

        rowsHtml += `
          <tr style="background-color: ${idx % 2 === 0 ? '#f8fafc' : '#ffffff'};">
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: bold; font-family: monospace;">#${inv.invoiceNumber}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; ${typeColor}">${typeStr}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: ${isRtl ? 'right' : 'left'}; font-weight: bold;">${entityName}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${formattedDate}</td>
            <td style="padding: 10px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-weight: bold;">${formatCurrency(inv.totalAmount, inv.currency)}</td>
          </tr>
        `;
      });

      const currentDate = new Date().toLocaleString(isRtl ? 'ar-JO' : 'en-US');

      const reportHtml = `
        <html>
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&family=Inter:wght@400;600;800&display=swap');
            body { 
              font-family: ${isRtl ? "'Cairo', serif" : "'Inter', sans-serif"}; 
              direction: ${isRtl ? 'rtl' : 'ltr'}; 
              padding: 40px; 
              color: #1e293b; 
              background: #fff;
              font-size: 11px;
            }
            .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px double #e2e8f0; padding-bottom: 20px; }
            .header-left { display: flex; flex-direction: column; }
            .company-name { font-size: 24px; font-weight: 900; color: #0f172a; letter-spacing: -0.5px; }
            .report-title { font-size: 15px; font-weight: 700; color: #4f46e5; margin-top: 5px; }
            .meta-item { margin-top: 4px; color: #64748b; font-size: 10px; font-weight: bold; }
            .summary-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 30px 0; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; text-align: center; }
            .card-label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: bold; letter-spacing: 0.5px; }
            .card-value { font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 5px; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #0d1221; color: #ffffff; padding: 12px 8px; font-weight: 700; font-size: 10px; text-align: center; }
            tr:nth-child(even) { background-color: #f8fafc; }
            .footer { margin-top: 40px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 9px; color: #64748b; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="header-left">
              <span class="company-name">${settings?.businessName || (isRtl ? 'مستودعي الذكي' : 'Mostawdaee')}</span>
              <span class="report-title">${isRtl ? 'تقرير وكشف الفواتير والحسابات المقارن' : 'Invoices Ledger Accounting Report'}</span>
            </div>
            <div style="text-align: ${isRtl ? 'left' : 'right'};">
              <div class="meta-item">${isRtl ? 'تاريخ التقرير' : 'Report Date'}: ${currentDate}</div>
              <div class="meta-item">${isRtl ? 'المستخدم المسؤول' : 'Responsible Operator'}: venusalhab@gmail.com</div>
              <div class="meta-item">${isRtl ? 'العملة الأساسية' : 'Base Currency'}: ${activeCurrency}</div>
            </div>
          </div>

          <div class="summary-cards">
            <div class="card">
              <div class="card-label">${isRtl ? 'مبيعات الكاش / الفواتير الصادرة' : 'Total Sales Book'}</div>
              <div class="card-value" style="color: #4f46e5;">${formatCurrency(totalSalesSum, activeCurrency)}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'مشتريات التوريد / الفواتير الواردة' : 'Total Purchases Book'}</div>
              <div class="card-value" style="color: #10b981;">${formatCurrency(totalPurchasesSum, activeCurrency)}</div>
            </div>
            <div class="card">
              <div class="card-label">${isRtl ? 'كشف الرصيد الحالي الصافي' : 'Net Sales Revenue'}</div>
              <div class="card-value" style="color: #e11d48;">${formatCurrency(totalSalesSum - totalPurchasesSum, activeCurrency)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="border-top-left-radius: 8px; border-bottom-left-radius: 8px;">${isRtl ? 'رقم الفاتورة' : 'Invoice Number'}</th>
                <th>${isRtl ? 'النوع' : 'Type'}</th>
                <th style="text-align: ${isRtl ? 'right' : 'left'};">${isRtl ? 'اسم الجهة (العميل / المورد)' : 'Dealing Party'}</th>
                <th>${isRtl ? 'التاريخ' : 'Date'}</th>
                <th style="border-top-right-radius: 8px; border-bottom-right-radius: 8px;">${isRtl ? 'القيمة النهائية الكلية' : 'Grand Total'}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            ${isRtl ? 'مستند محاسبي مؤتمت تم توليده عبر بوابة مستودعي للمخازن ونقاط البيع' : 'Automated Accountant Statement - Generated via Mostawdaee ERP Ledger Services'}
          </div>
        </body>
        </html>
      `;

      doc.open();
      doc.write(reportHtml);
      doc.close();

      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
       setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 250);

      toast.success(isRtl ? 'كشف الحساب موجه وجاهز للطباعة وتنزيل الـ PDF! 📄🖨️' : 'Invoices accounting ledger PDF prepared for download successfully!');
    } catch (e) {
      console.error(e);
      toast.error(isRtl ? 'فشل تصدير فواتير كـ PDF' : 'Failed to export invoices to PDF');
    }
  };

  const exportSingleInvoiceToPDF = (inv: Invoice) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0px';
      iframe.style.height = '0px';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) return;

      const currencyStr = inv.currency || activeCurrency;
      const symbolMap: Record<string, string> = {
        JOD: 'د.أ',
        ILS: '₪',
        USD: '$'
      };
      const symbol = symbolMap[currencyStr] || currencyStr;
      
      const formatLocalCurrency = (val: number) => {
        return globalFormatPrice(val, symbol);
      };

      let itemsHtml = '';
      inv.items.forEach((item, idx) => {
        itemsHtml += `
          <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}; transition: background-color 0.2s;">
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: ${isRtl ? 'right' : 'left'}; font-weight: 600; color: #1e293b;">
              ${item.description}
              <div style="font-size: 9px; color: #64748b; font-weight: normal; margin-top: 2px;">ID: ${item.productId.slice(0, 8)}</div>
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: #334155;">${item.quantity}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-weight: 650; color: #475569;">${formatLocalCurrency(item.unitPrice)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: ${isRtl ? 'left' : 'right'}; font-family: monospace; font-weight: 800; color: #4f46e5;">${formatLocalCurrency(item.total)}</td>
          </tr>
        `;
      });

      const currentDate = new Date(inv.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
      const currentTime = new Date(inv.date).toLocaleTimeString(isRtl ? 'ar-JO' : 'en-US', { hour: '2-digit', minute: '2-digit' });
      const documentTypeTitle = inv.type === 'sale' 
        ? (isRtl ? 'فاتورة ضريبية رسمية' : 'OFFICIAL TAX SALES INVOICE') 
        : (isRtl ? 'فاتورة شراء مستودعية' : 'WAREHOUSE PURCHASE INVOICE');

      const logoHtml = settings?.companyLogoUrl 
        ? `<img src="${settings.companyLogoUrl}" alt="Logo" style="max-height: 70px; max-width: 140px; object-fit: contain; display: block;" referrerPolicy="no-referrer" />`
        : `<div style="width: 48px; height: 48px; background-color: #4f46e5; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-size: 20px; font-family: sans-serif;">M</div>`;

      const singleInvoiceHtml = `
        <html>
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Inter:wght@400;600;700;800&display=swap');
            @page {
              size: A4;
              margin: 15mm 15mm 20mm 15mm;
            }
            body { 
              font-family: ${isRtl ? "'Cairo', serif" : "'Inter', sans-serif"}; 
              direction: ${isRtl ? 'rtl' : 'ltr'}; 
              padding: 0; 
              color: #1e293b; 
              background: #fff;
              font-size: 11px;
              line-height: 1.5;
            }
            /* Printable frame optimization */
            .invoice-wrapper {
              max-width: 800px;
              margin: 0 auto;
              position: relative;
            }
            .accent-top-bar {
              height: 4px;
              background: linear-gradient(90deg, #22d3ee, #3b82f6, #6366f1);
              margin-bottom: 25px;
              border-radius: 2px;
            }
            .letterhead-container {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #f1f5f9;
              padding-bottom: 25px;
              margin-bottom: 25px;
            }
            .logo-title-group {
              display: flex;
              align-items: center;
              gap: 15px;
            }
            .business-name {
              font-size: 20px;
              font-weight: 900;
              color: #0f172a;
              letter-spacing: -0.5px;
            }
            .business-tagline {
              font-size: 9px;
              text-transform: uppercase;
              color: #6366f1;
              font-weight: 800;
              letter-spacing: 0.5px;
              display: block;
              margin-top: 1px;
            }
            .doc-heading-box {
              text-align: center;
              margin-bottom: 25px;
            }
            .doc-heading-title {
              font-size: 14px;
              font-weight: 900;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              color: #4f46e5;
              padding: 8px 18px;
              border-radius: 12px;
              display: inline-block;
              letter-spacing: 0.25px;
            }
            .metadata-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 20px;
              margin-bottom: 25px;
            }
            .meta-column {
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .meta-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .meta-label {
              font-weight: 700;
              color: #64748b;
              font-size: 10px;
            }
            .meta-value {
              font-weight: 800;
              color: #1e293b;
            }
            .meta-value-highlight {
              font-weight: 900;
              color: #4f46e5;
              font-family: monospace;
              font-size: 13px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 25px;
            }
            th {
              background-color: #0f172a;
              color: #ffffff;
              padding: 12px 16px;
              font-weight: 700;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .summary-block-grid {
              display: grid;
              grid-template-columns: 1.2fr 0.8fr;
              gap: 25px;
              margin-bottom: 30px;
            }
            .notes-card {
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 15px;
            }
            .notes-title {
              font-size: 9px;
              font-weight: 800;
              text-transform: uppercase;
              color: #64748b;
              letter-spacing: 0.5px;
              margin-bottom: 8px;
              display: block;
            }
            .notes-content {
              font-size: 10px;
              color: #475569;
              line-height: 1.6;
              margin: 0;
            }
            .math-card {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .math-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 11px;
              padding: 0 5px;
            }
            .math-label {
              font-weight: 750;
              color: #64748b;
            }
            .math-value {
              font-weight: 800;
              color: #1e293b;
              font-family: monospace;
            }
            .grand-total-container {
              background-color: #0f172a;
              color: #ffffff;
              border-radius: 12px;
              padding: 15px 20px;
              margin-top: 5px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
            }
            .grand-total-label {
              font-weight: 900;
              font-size: 11px;
              letter-spacing: 1px;
            }
            .grand-total-value {
              font-size: 20px;
              font-weight: 900;
              font-family: monospace;
            }
            .signature-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 40px;
              text-align: center;
              margin-top: 35px;
              padding-top: 25px;
              border-top: 1px dashed #cbd5e1;
            }
            .sign-leader {
              font-size: 10px;
              font-weight: 800;
              color: #64748b;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 12px;
              display: block;
            }
            .sign-line {
              height: 44px;
              border: 1px dashed #cbd5e1;
              background-color: #fafafa;
              border-radius: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #94a3b8;
              font-size: 9px;
              font-style: italic;
            }
            .footer {
              text-align: center;
              border-top: 2px solid #f1f5f9;
              padding-top: 20px;
              margin-top: 35px;
            }
            .footer-thankyou {
              font-size: 13px;
              font-weight: 900;
              color: #0f172a;
              margin: 0 0 5px 0;
            }
            .footer-rights {
              font-size: 9px;
              font-weight: 700;
              color: #94a3b8;
              letter-spacing: 0.5px;
              margin: 0;
              text-transform: uppercase;
            }
            /* Media Queries for printing */
            @media print {
              body {
                padding: 0;
                background-color: #fff;
              }
              .accent-top-bar {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .grand-total-container {
                background-color: #0f172a !important;
                color: #ffffff !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              th {
                background-color: #0f172a !important;
                color: #ffffff !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .doc-heading-title {
                background-color: #f8fafc !important;
                color: #4f46e5 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .metadata-grid {
                background-color: #f8fafc !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="invoice-wrapper">
            <div class="accent-top-bar"></div>
            
            <div class="letterhead-container">
              <!-- Right Side: Business Identity -->
              <div style="display: flex; flex-direction: column; gap: 8px; width: 60%;">
                <div class="logo-title-group">
                  ${logoHtml}
                  <div style="text-align: ${isRtl ? 'right' : 'left'};">
                    <span class="business-name">${settings?.businessName || (isRtl ? 'شركة مستودعي التجارية' : 'Mostawdaee Trading Company')}</span>
                    <span class="business-tagline">${isRtl ? 'النظام المتكامل لإدارة المخازن والمبيعات' : 'Smart Solutions for Inventory & Commerce'}</span>
                  </div>
                </div>
                
                <div style="font-size: 10px; color: #475569; font-weight: 600; margin-top: 8px; text-align: ${isRtl ? 'right' : 'left'}; display: flex; flex-direction: column; gap: 3px;">
                  ${settings?.businessAddress ? `<div>📍 ${settings.businessAddress}</div>` : ''}
                  ${settings?.businessPhone ? `<div>📞 <span style="font-family: monospace;">${settings.businessPhone}</span></div>` : ''}
                  ${settings?.businessEmail ? `<div>✉️ ${settings.businessEmail}</div>` : ''}
                  ${settings?.taxRegistrationNumber ? `<div style="font-weight: 800; color: #4f46e5; margin-top: 3px;">📝 ${isRtl ? 'الرقم الضريبي المسجل:' : 'VAT Registration Number:'} <span style="font-family: monospace;">${settings.taxRegistrationNumber}</span></div>` : ''}
                </div>
              </div>

              <!-- Left Side: System/Stamp placeholder -->
              <div style="text-align: ${isRtl ? 'left' : 'right'}; font-size: 10px; color: #64748b; font-weight: bold; width: 35%;">
                <div style="font-size: 14px; font-weight: 900; color: #0d1221; letter-spacing: -0.5px;">MOSTAWDAll</div>
                <div style="font-size: 8px; color: #6366f1; letter-spacing: 1px; margin-top: 1px;">DIGITAL ERP LEDGER</div>
                <div style="margin-top: 10px; font-family: monospace; font-size: 9px; line-height: 1.4;">
                  <div>Time: ${currentTime}</div>
                  <div>Operator: venusalhab@gmail.com</div>
                </div>
              </div>
            </div>

            <div class="doc-heading-box">
              <span class="doc-heading-title">${documentTypeTitle}</span>
            </div>

            <div class="metadata-grid">
              <!-- Column 1 -->
              <div class="meta-column" style="${isRtl ? 'border-left: 1px solid #e1e8f0; padding-left: 20px;' : 'border-right: 1px solid #e1e8f0; padding-right: 20px;'}">
                <div class="meta-row">
                  <span class="meta-label">${isRtl ? 'رقم الفاتورة:' : 'INVOICE NUMBER:'}</span>
                  <span class="meta-value-highlight">#${inv.invoiceNumber}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">${isRtl ? 'تاريخ المعاملة:' : 'TRANSACTION DATE:'}</span>
                  <span class="meta-value">${currentDate}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">${isRtl ? 'طريقة الدفع للتسوية:' : 'PAYMENT MODE:'}</span>
                  <span class="meta-value" style="color: ${inv.type === 'sale' ? '#4f46e5' : '#10b981'}; font-weight: 800;">
                    ${inv.type === 'sale' ? (isRtl ? 'مبيعات' : 'Sales') : (isRtl ? 'مشتريات' : 'Purchase')}
                  </span>
                </div>
              </div>

              <!-- Column 2 -->
              <div class="meta-column" style="${isRtl ? 'padding-right: 20px;' : 'padding-left: 20px;'}">
                <div class="meta-row">
                  <span class="meta-label">
                    ${inv.type === 'sale' ? (isRtl ? 'الجهة المستلمة (العميل):' : 'BILLING CLIENT:') : (isRtl ? 'جهة التوريد (المورد):' : 'BILLING SUPPLIER:')}
                  </span>
                  <span class="meta-value" style="font-weight: 900; color: #0f172a; font-size: 12px;">
                    ${inv.customerName || inv.supplierName || (isRtl ? 'زبون نقدي عام' : 'General Client/Walk-in')}
                  </span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">${isRtl ? 'العملة الأساسية للفاتورة:' : 'SETTLEMENT CURRENCY:'}</span>
                  <span class="meta-value" style="font-family: monospace;">${currencyStr}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">${isRtl ? 'حالة القيد المعتمدة:' : 'REGISTRATION STATUS:'}</span>
                  <span class="meta-value" style="color: #10b981; font-weight: bold;">✓ ${isRtl ? 'مؤمن ومسحوب' : 'Authorized & Sync'}</span>
                </div>
              </div>
            </div>

            <!-- Table -->
            <table>
              <thead>
                <tr>
                  <th style="border-top-${isRtl ? 'right' : 'left'}-radius: 8px; border-bottom-${isRtl ? 'right' : 'left'}-radius: 8px; text-align: ${isRtl ? 'right' : 'left'};">${isRtl ? 'رمز الصنف والمواصفات التفصيلية للمادة' : 'Product description / SKU'}</th>
                  <th style="text-align: center; width: 15%;">${isRtl ? 'الكمية' : 'Qty'}</th>
                  <th style="text-align: center; width: 20%;">${isRtl ? 'سعر المفرد' : 'Unit Price'}</th>
                  <th style="border-top-${isRtl ? 'left' : 'right'}-radius: 8px; border-bottom-${isRtl ? 'left' : 'right'}-radius: 8px; text-align: ${isRtl ? 'left' : 'right'}; width: 25%;">${isRtl ? 'المجموع النهائي' : 'Subtotal'}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="summary-block-grid">
              <!-- Legal Disclaimer & Terms -->
              <div class="notes-card">
                <span class="notes-title">${isRtl ? 'شروط وأحكام الفاتورة القانونية' : 'Terms & Legal Declarations'}</span>
                <p class="notes-content">
                  ${isRtl 
                    ? `1. البضاعة المباعة خاضعة للفحص الجمركي والخصم الفوري من مستودعاتنا المعتمدة.<br/>
                       2. يرجى مراجعة الرصيد والكميات قبل مغادرة المستودع أو نقطة البيع لضمان جودة الأجهزة والمواد.<br/>
                       3. الفاتورة الضريبية تعتبر سنداً مالياً قانونياً واجب الدفع وموثقاً لدى السجل المحاسبي المركزي.`
                    : `1. Goods delivered should be inspected regarding quantities and specs before cargo departure.<br/>
                       2. Claims corresponding to damaged objects or serial numbers should be addressed to administrators within 3 working days.<br/>
                       3. This tax statement serves as an authorized contract of corporate settlement.`
                  }
                </p>
              </div>

              <!-- Mathematical summary calculations -->
              <div class="math-card">
                <div class="math-row">
                  <span class="math-label">${isRtl ? 'المجموع الصافي الفرعي:' : 'SUBTOTAL VALUE:'}</span>
                  <span class="math-value">${formatLocalCurrency(inv.subtotal)}</span>
                </div>
                <div class="math-row">
                  <span class="math-label">${isRtl ? 'ضريبة القيمة المضافة' : 'VAT TAX AMOUNT'} (${settings?.defaultVatRate || 16}%):</span>
                  <span class="math-value" style="font-family: monospace; font-weight: 800;">${formatLocalCurrency(inv.taxAmount)}</span>
                </div>
                
                <div class="grand-total-container">
                  <span class="grand-total-label">${isRtl ? 'الإجمالي النهائي الكلي:' : 'GRAND TOTAL:'}</span>
                  <span class="grand-total-value">${formatLocalCurrency(inv.totalAmount)}</span>
                </div>
              </div>
            </div>

            <div class="signature-grid">
              <div>
                <span class="sign-leader">${isRtl ? 'توقيع المشتري / العميل المستلم' : 'Authorized Recipient Sign'}</span>
                <div class="sign-line">${isRtl ? 'توقيع العميل / المفوض قانونياً' : 'Sign and Date'}</div>
              </div>
              <div>
                <span class="sign-leader">${isRtl ? 'ختم الشركة واعتماد البائع' : 'Seller Audit & Company Stamp'}</span>
                <div class="sign-line">${settings?.businessName || (isRtl ? 'أمين الصندوق والختم' : 'Cashier Seal & Stamp')}</div>
              </div>
            </div>

            <div class="footer">
              <h4 class="footer-thankyou">${isRtl ? 'نشكركم لثقتكم واختياركم خدماتنا!' : 'Thank you for choosing our quality catalog & products!'}</h4>
              <p class="footer-rights">${isRtl ? 'نظام مستودعي الذكي لإدارة السلاسل اللوجستية والمستودعات' : 'Automated Supply Chain Ledger System - Powered by Mostawdaee ERP'}</p>
            </div>
          </div>
        </body>
        </html>
      `;

      doc.open();
      doc.write(singleInvoiceHtml);
      doc.close();

      iframe.contentWindow?.focus();
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 250);

      toast.success(isRtl ? `تم توليد الفاتورة #${inv.invoiceNumber} كملف PDF بنجاح! 📄🖨️` : `Invoice #${inv.invoiceNumber} PDF generated successfully!`);
    } catch (e) {
      console.error(e);
      toast.error(isRtl ? 'فشل تصدير الفاتورة كـ PDF' : 'Failed to export invoice to PDF');
    }
  };

  const addItem = (product: Product) => {
    // Check stock for sales
    if (invoiceType === 'sale' && product.quantity <= 0) {
      toast.error(t.outOfStock);
      return;
    }

    const price = Number(invoiceType === 'sale' ? product.sellingPrice : product.unitCost) || 0;
    const existing = invoiceItems.find(item => item.productId === product.id);
    
    if (existing) {
      const existingQty = Number(existing.quantity) || 0;
      const productQty = Number(product.quantity) || 0;
      if (invoiceType === 'sale' && existingQty >= productQty) {
        toast.error(`${t.stock}: ${productQty}`);
        return;
      }
      setInvoiceItems(invoiceItems.map(item => {
        if (item.productId === product.id) {
          const newQty = (Number(item.quantity) || 0) + 1;
          const uPrice = Number(item.unitPrice) || 0;
          return { ...item, quantity: newQty, total: Number((newQty * uPrice).toFixed(4)) };
        }
        return item;
      }));
    } else {
      setInvoiceItems([...invoiceItems, {
        productId: product.id,
        description: product.name,
        quantity: 1,
        unitPrice: price,
        total: price
      }]);
    }
  };

  const updateItem = (productId: string, quantity: number, unitPrice: number) => {
    const product = products.find(p => p.id === productId);
    const targetQty = Number(quantity) || 0;
    const targetPrice = Number(unitPrice) || 0;
    const productQty = Number(product?.quantity) || 0;
    
    if (invoiceType === 'sale' && product && targetQty > productQty) {
      toast.error(`${t.stock}: ${productQty}`);
      return;
    }

    setInvoiceItems(invoiceItems.map(item => {
      if (item.productId === productId) {
        const finalQty = Math.max(1, targetQty);
        return { ...item, quantity: finalQty, unitPrice: targetPrice, total: Number((finalQty * targetPrice).toFixed(4)) };
      }
      return item;
    }));
  };

  const removeItem = (productId: string) => {
    setInvoiceItems(invoiceItems.filter(item => item.productId !== productId));
  };

  const handleCreateInvoice = async (shouldPrint = false) => {
    if (invoiceItems.length === 0) return;
    if (invoiceType === 'sale' && !customerName) {
      toast.error(t.clientName);
      return;
    }
    if (invoiceType === 'purchase' && !supplierName) {
      toast.error(isRtl ? 'يرجى إدخال اسم المورد' : 'Supplier name is required');
      return;
    }

    setIsSubmitting(true);
    const subtotal = Number(invoiceItems.reduce((acc, item) => acc + (Number(item.total) || 0), 0).toFixed(4));
    const vatRate = Number(settings?.defaultVatRate) || 0;
    const tax = Number(((subtotal * vatRate) / 100).toFixed(4));
    
    const invoiceNo = consumeInvoiceNumber(invoiceType === 'sale' ? 'SAL' : 'PUR', user?.uid || 'guest');
    
    const newInvoice: Invoice = {
      id: crypto.randomUUID(),
      invoiceNumber: invoiceNo,
      customerName: invoiceType === 'sale' ? customerName : undefined,
      supplierName: invoiceType === 'purchase' ? supplierName : undefined,
      date: Date.now(),
      items: invoiceItems,
      subtotal,
      taxAmount: tax,
      totalAmount: Number((subtotal + tax).toFixed(4)),
      type: invoiceType,
      currency: invoiceCurrency
    };

    try {
      await saveInvoice(newInvoice);
      if (shouldPrint) {
        setSelectedInvoice(newInvoice);
        setView('view');
        setCustomerName('');
        setSupplierName('');
        setInvoiceItems([]);
        toast.success(isRtl ? "تم حفظ الفاتورة بنجاح وجاري تحضير الطباعة..." : "Invoice saved! Opening print manager...");
        setTimeout(() => {
          exportSingleInvoiceToPDF(newInvoice);
        }, 400);
      } else {
        setNewInvoiceSuccess(true);
        setTimeout(() => {
          setNewInvoiceSuccess(false);
          setView('list');
          setCustomerName('');
          setSupplierName('');
          setInvoiceItems([]);
        }, 2000);
      }
    } catch (error) {
      console.error(error);
      const msg = String((error as any)?.message || '');
      if (msg.startsWith('Insufficient vault funds')) {
        toast.error(isRtl ? 'رصيد الخزنة بهذه العملة غير كافٍ لدفع فاتورة الشراء. أضف رصيداً للخزنة أو غيّر العملة.' : 'Not enough balance in the vault for this currency to pay this purchase. Deposit funds or change the currency.');
      } else if (!msg.startsWith('Insufficient stock')) {
        toast.error(isRtl ? "فشلت عملية حفظ الفاتورة" : "Failed to record invoice");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const quickSellProducts = React.useMemo(() => {
    if (invoiceType !== 'sale') return [];
    
    const productCounts: Record<string, number> = {};
    invoices.filter(inv => inv.type === 'sale').forEach(inv => {
      inv.items.forEach(item => {
        productCounts[item.productId] = (productCounts[item.productId] || 0) + 1;
      });
    });

    const sortedBySales = products
      .filter(p => p.quantity > 0)
      .sort((a, b) => (productCounts[b.id] || 0) - (productCounts[a.id] || 0));

    return sortedBySales.slice(0, 4);
  }, [invoices, products, invoiceType]);

  return (
    <div className={`space-y-8 px-4 sm:px-0 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{t.salesAndPurchases}</h2>
          <p className="text-gray-500 mt-1">{t.officialInvoice}</p>
        </div>
        {view === 'list' ? (
          <button
            onClick={() => setView('create')}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 hover:bg-indigo-700 transition-all premium-button"
          >
            <Plus size={20} />
            {t.newTransaction}
          </button>
        ) : (
          <button
            onClick={() => setView('list')}
            className="px-6 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-2xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
          >
            {t.cancel}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {view === 'list' && (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Search and Sort Controls */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col md:flex-row gap-4 items-center premium-card">
              <div className="relative flex-1 w-full">
                <Search size={18} className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'} text-gray-400`} />
                <input 
                  type="text"
                  placeholder={t.searchPlaceholder}
                  value={invSearchTerm}
                  onChange={(e) => setInvSearchTerm(e.target.value)}
                  className={`w-full ${isRtl ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-3 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all dark:text-white`}
                />
              </div>
              <div className="flex gap-2 w-full md:w-auto flex-wrap sm:flex-nowrap">
                {(['date', 'totalAmount'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => handleSort(key)}
                    className={`flex-1 md:flex-none px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                      sortConfig.key === key ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100 dark:shadow-indigo-900/20 font-bold' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-700 hover:border-indigo-200'
                    }`}
                  >
                    {key === 'date' ? t.date : t.total} {sortConfig.key === key && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </button>
                ))}

                {/* Accounting Ledger Exports */}
                <span className="h-6 w-[1px] bg-gray-200 dark:bg-gray-750 hidden md:block self-center" />
                <button
                  type="button"
                  onClick={exportInvoicesToCSV}
                  title={isRtl ? 'تصدير كشف الحساب الحالي لملف Excel/CSV' : 'Export current list as CSV/Excel'}
                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-3 bg-emerald-600/10 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/50 rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  <Download size={14} />
                  <span>{isRtl ? 'تصدير Excel' : 'Export Excel'}</span>
                </button>
                <button
                  type="button"
                  onClick={exportInvoicesToPDF}
                  title={isRtl ? 'تنزيل وطباعة كشف حساب الفواتير كـ PDF' : 'Download and print ledger audit PDF'}
                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-4 py-3 bg-indigo-600/10 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/50 rounded-xl text-xs font-black transition-all cursor-pointer"
                >
                  <FileText size={14} />
                  <span>{isRtl ? 'كشف PDF' : 'Ledger PDF'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedInvoices.map((inv) => (
                <motion.div 
                  key={inv.id}
                  whileHover={{ y: -5, scale: 1.02 }}
                onClick={() => {
                  setSelectedInvoice(inv);
                  setView('view');
                }}
                className={`bg-white dark:bg-gray-800 p-6 rounded-3xl border ${inv.type === 'sale' ? 'border-indigo-100 dark:border-indigo-900/50' : 'border-emerald-100 dark:border-emerald-900/50'} shadow-sm cursor-pointer premium-card group relative overflow-hidden`}
              >
                <div className={`absolute top-0 right-0 w-1.5 h-full ${inv.type === 'sale' ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-12 h-12 ${inv.type === 'sale' ? 'bg-indigo-50' : 'bg-emerald-50'} dark:bg-gray-700 rounded-2xl flex items-center justify-center ${inv.type === 'sale' ? 'text-indigo-600' : 'text-emerald-600'} transition-colors`}>
                    <FileText size={24} />
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{inv.type === 'sale' ? t.sale : t.purchase}</div>
                    <div className="text-xs font-bold text-gray-500">{inv.invoiceNumber}</div>
                    <div className="text-sm font-mono text-gray-600 dark:text-gray-400">
                      {new Date(inv.date).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{inv.customerName || inv.supplierName || (isRtl ? 'عميل افتراضي' : 'Standard Client')}</h3>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-50 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        exportSingleInvoiceToPDF(inv);
                      }}
                      title={isRtl ? 'تصدير هذه الفاتورة كملف PDF مجهز للطباعة' : 'Export this invoice as print-ready PDF'}
                      className="py-1.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600/50 transition-colors cursor-pointer flex items-center gap-1.5 text-[10px] font-black"
                    >
                      <Download size={11} />
                      <span>{isRtl ? 'تحميل PDF' : 'PDF'}</span>
                    </button>
                    <span className={`text-xl font-black ${inv.type === 'sale' ? 'text-indigo-600' : 'text-emerald-600'} font-mono`}>{formatCurrency(inv.totalAmount, inv.currency)}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

        {view === 'create' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-xl overflow-hidden premium-card"
          >
            {newInvoiceSuccess ? (
              <div className="p-20 text-center flex flex-col items-center gap-4">
                <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{t.transactionSuccess}</h3>
              </div>
            ) : (
              <div className="flex flex-col h-full lg:flex-row">
                {/* Left: Product Picker */}
                <div className="p-8 border-r border-gray-100 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/30 w-full lg:w-[40%]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-black text-gray-900 dark:text-white">{t.inventory}</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-800 p-1.5 rounded-2xl">
                      <button
                        onClick={() => { setInvoiceType('sale'); setInvoiceItems([]); }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${invoiceType === 'sale' ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {t.sale}
                      </button>
                      <button
                        onClick={() => { setInvoiceType('purchase'); setInvoiceItems([]); }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${invoiceType === 'purchase' ? 'bg-white dark:bg-gray-700 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {t.purchase}
                      </button>
                    </div>
                  </div>

                  {quickSellProducts.length > 0 && (
                    <div className="mb-6 space-y-3">
                      <div className="flex items-center gap-2 text-gray-500 mb-2 px-1">
                        <TrendingUp size={14} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{t.frequentItems}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {quickSellProducts.map(p => (
                          <button
                            key={`quick-${p.id}`}
                            onClick={() => addItem(p)}
                            className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl text-right hover:border-indigo-400 transition-all group"
                          >
                            <div className="font-bold text-xs text-indigo-900 dark:text-indigo-100 truncate group-hover:text-indigo-600 transition-colors">{p.name}</div>
                            <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">{formatCurrency(p.sellingPrice)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative mb-6">
                    <Search className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-gray-400`} size={18} />
                    <input 
                      type="text"
                      placeholder={t.searchPlaceholder}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pr-12 pl-12 py-3.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white font-medium"
                    />
                  </div>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                    {filteredProducts.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addItem(p)}
                        className={`w-full p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl flex items-center justify-between hover:border-indigo-600 dark:hover:border-indigo-500 group transition-all text-right ${invoiceType === 'sale' && p.quantity <= 0 ? 'opacity-50 grayscale' : ''}`}
                      >
                        <PlusCircle size={20} className="text-gray-300 dark:text-gray-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                        <div>
                          <div className="font-bold text-gray-900 dark:text-white">{p.name}</div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-lg text-gray-500 font-mono">Stock: {p.quantity}</span>
                            <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-mono">{formatCurrency(invoiceType === 'sale' ? p.sellingPrice : p.unitCost)}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Invoice Builder */}
                <div className="p-8 space-y-6 flex-1 bg-white dark:bg-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-widest">{t.billingDetails}</h3>
                    <div className="px-4 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest">
                      {invoiceType === 'sale' ? t.newSale : t.newPurchase}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase flex items-center gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
                          <User size={12} />
                          {invoiceType === 'sale' ? t.clientName : t.customerSupplier}
                        </label>
                        <input 
                          type="text"
                          value={invoiceType === 'sale' ? customerName : supplierName}
                          onChange={(e) => invoiceType === 'sale' ? setCustomerName(e.target.value) : setSupplierName(e.target.value)}
                          placeholder={invoiceType === 'sale' ? t.placeholderUserName : t.placeholderBusinessName}
                          className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none text-right font-bold dark:text-white transition-all"
                        />
                      </div>
                      <div className="md:col-span-1 space-y-1.5">
                        <label className="text-[10px] font-black text-gray-400 uppercase flex items-center gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
                          <span>💵</span>
                          {isRtl ? "العملة" : "Currency"}
                        </label>
                        <select
                          value={invoiceCurrency}
                          onChange={(e) => setInvoiceCurrency(e.target.value as Currency)}
                          className="w-full px-4 py-3.5 bg-gray-50 dark:bg-gray-900 border border-transparent dark:border-gray-700 rounded-2xl focus:bg-white dark:focus:bg-gray-800 focus:border-indigo-500 outline-none font-bold dark:text-white transition-all text-center select-none"
                        >
                          <option value="JOD">JOD ($)</option>
                          <option value="ILS">ILS (₪)</option>
                          <option value="USD">USD ($)</option>
                        </select>
                      </div>
                    </div>

                    <div className="bg-gray-50/50 dark:bg-gray-900/50 p-6 rounded-[2.5rem] space-y-4 min-h-[400px] border-2 border-dashed border-gray-100 dark:border-gray-700 overflow-y-auto">
                      {invoiceItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4 mt-20 opacity-40">
                          <PlusCircle size={48} strokeWidth={1} />
                          <p className="font-bold text-sm tracking-widest uppercase">{t.searchPlaceholder}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {invoiceItems.map(item => (
                            <div key={item.productId} className="flex items-center justify-between bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 group hover:shadow-md transition-all">
                              <button onClick={() => removeItem(item.productId)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 p-2 rounded-xl transition-colors">
                                <Trash2 size={18} />
                              </button>
                              
                              <div className="flex-1 flex flex-col items-center gap-2">
                                <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900 px-3 py-1 rounded-xl">
                                  <button onClick={() => updateItem(item.productId, item.quantity - 1, item.unitPrice)} className="text-gray-400 hover:text-indigo-600 font-black text-lg">-</button>
                                  <span className="font-mono font-black text-gray-900 dark:text-white w-8 text-center">{item.quantity}</span>
                                  <button onClick={() => updateItem(item.productId, item.quantity + 1, item.unitPrice)} className="text-gray-400 hover:text-indigo-600 font-black text-lg">+</button>
                                </div>
                                <div className="flex items-center gap-1 font-mono text-[10px] font-black text-gray-400">
                                  <span>{invoiceCurrency === 'JOD' ? 'د.أ' : invoiceCurrency === 'USD' ? '$' : '₪'}</span>
                                  <input 
                                    type="number" 
                                    value={item.unitPrice} 
                                    onChange={(e) => updateItem(item.productId, item.quantity, parseFloat(e.target.value) || 0)}
                                    className="w-16 bg-transparent outline-none text-center focus:text-indigo-600"
                                  />
                                </div>
                              </div>

                              <div className="text-right flex-1 pr-4">
                                <div className="font-black text-gray-900 dark:text-gray-100 leading-tight">{item.description}</div>
                                <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 mt-1 font-mono">{formatCurrency(item.total, invoiceCurrency)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pt-6 px-4">
                      <div className="flex justify-between text-xs font-black text-gray-400 uppercase tracking-widest">
                        <span className="font-mono">{formatCurrency(invoiceItems.reduce((acc, item) => acc + item.total, 0) * (settings?.defaultVatRate || 0) / 100, invoiceCurrency)}</span>
                        <span>{t.tax} ({settings?.defaultVatRate}%)</span>
                      </div>
                      <div className="flex justify-between text-2xl font-black text-indigo-600 dark:text-indigo-400 pt-3 border-t-2 border-gray-50 dark:border-gray-700">
                        <span className="font-mono">{formatCurrency(invoiceItems.reduce((acc, item) => acc + item.total, 0) * (1 + (settings?.defaultVatRate || 0) / 100), invoiceCurrency)}</span>
                        <span className="uppercase tracking-tighter">{t.total}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                      {/* Save without printing button */}
                      <button
                        type="button"
                        disabled={isSubmitting || invoiceItems.length === 0 || (invoiceType === 'sale' ? !customerName : !supplierName)}
                        onClick={() => handleCreateInvoice(false)}
                        className="flex-1 py-4 px-6 bg-white dark:bg-gray-805 text-gray-750 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 rounded-2xl font-bold text-sm shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {isSubmitting ? (
                          <svg className="animate-spin h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <FileText size={18} />
                        )}
                        <span>{isRtl ? "حفظ بدون طباعة" : "Save without Printing"}</span>
                      </button>

                      {/* Save and print button */}
                      <button
                        type="button"
                        disabled={isSubmitting || invoiceItems.length === 0 || (invoiceType === 'sale' ? !customerName : !supplierName)}
                        onClick={() => handleCreateInvoice(true)}
                        className={`flex-1 py-4 px-6 ${
                          invoiceType === 'sale' 
                            ? 'bg-indigo-650 shadow-indigo-100 dark:shadow-indigo-900/30 hover:bg-indigo-700' 
                            : 'bg-emerald-600 shadow-emerald-100 dark:shadow-emerald-900/30 hover:bg-emerald-700'
                        } text-white rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 cursor-pointer`}
                      >
                        {isSubmitting ? (
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <Printer size={18} />
                        )}
                        <span>{isRtl ? "حفظ وطباعة الفاتورة" : "Save & Print Invoice"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {view === 'view' && selectedInvoice && (
          <motion.div
            key="view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-8 w-full"
          >
            {/* Action Bar */}
            <div className="flex gap-4 w-full justify-end px-4 no-print class-action-bar">
              <button
                onClick={() => {
                  setView('list');
                  setSelectedInvoice(null);
                }}
                className="flex items-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold transition-all active:scale-95 cursor-pointer no-print"
              >
                {isRtl ? 'العودة للسجل' : 'Back to List'}
              </button>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: `Invoice ${selectedInvoice.invoiceNumber}`,
                      text: `Invoice ${selectedInvoice.invoiceNumber} for ${selectedInvoice.customerName || selectedInvoice.supplierName}`,
                      url: window.location.href,
                    });
                  }
                }}
                className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-700 rounded-2xl font-bold shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-95 cursor-pointer no-print"
              >
                <Share2 size={20} />
                {t.shareInvoice}
              </button>
              <button
                onClick={() => exportSingleInvoiceToPDF(selectedInvoice)}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-650 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 dark:shadow-indigo-900/30 hover:bg-indigo-700 transition-all active:scale-95 cursor-pointer no-print"
              >
                <Printer size={20} />
                {isRtl ? 'حفظ كـ PDF / طباعة' : 'Save as PDF / Print'}
              </button>
            </div>

            {/* Printable Area - Premium Formal A4 Invoice Layout */}
            <div 
              id="invoice-capture"
              ref={printRef}
              className="w-full max-w-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl p-8 sm:p-14 rounded-[2rem] border border-slate-200 dark:border-slate-800 invoice-print relative overflow-hidden"
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              {/* Top Premium Luminous Accent Bar */}
              <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600" />
              <div className="border-b-4 border-double border-slate-300 dark:border-slate-700 pb-8 mb-8 text-slate-800 dark:text-slate-100">
                <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-6">
                  {/* Right Header Side (Arabic Letterhead info) */}
                  <div className="space-y-2 text-center md:text-right flex-1 w-full order-2 md:order-1">
                    <div className="flex items-center justify-center md:justify-start gap-3">
                      {settings?.companyLogoUrl ? (
                        <div className="w-16 h-16 bg-white rounded-xl border border-slate-200 p-1 flex items-center justify-center shadow-sm shrink-0">
                          <img 
                            src={settings.companyLogoUrl} 
                            alt="Logo" 
                            className="max-w-full max-h-full object-contain"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-indigo-500/10 shrink-0">
                          <Building size={24} />
                        </div>
                      )}
                      <div className="text-right">
                        <span className="text-xl font-black text-slate-900 dark:text-white block tracking-tight">
                          {settings?.businessName || (isRtl ? 'مستودعي الذكي' : 'Smart Warehouse')}
                        </span>
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-extrabold uppercase tracking-widest block">
                          {isRtl ? 'إدارة المستودعات ونقاط البيع' : 'Warehouse & Business System'}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400 font-bold space-y-1 mt-3">
                      {settings?.businessAddress && (
                        <p className="flex items-center justify-center md:justify-start gap-1">
                          <span>📍</span>
                          <span>{settings.businessAddress}</span>
                        </p>
                      )}
                      {settings?.businessPhone && (
                        <p className="flex items-center justify-center md:justify-start gap-1">
                          <span>📞</span>
                          <span className="font-mono">{settings.businessPhone}</span>
                        </p>
                      )}
                      {settings?.businessEmail && (
                        <p className="flex items-center justify-center md:justify-start gap-1">
                          <span>✉️</span>
                          <span>{settings.businessEmail}</span>
                        </p>
                      )}
                      {settings?.taxRegistrationNumber && (
                        <p className="flex items-center justify-center md:justify-start gap-1 bg-amber-500/5 dark:bg-amber-500/10 px-2 py-1 rounded inline-block text-amber-700 dark:text-amber-400 font-black">
                          <span>📝 {isRtl ? 'الرقم الضريبي:' : 'VAT ID:'}</span>
                          <span className="font-mono">{settings.taxRegistrationNumber}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Middle Section (Official Document Title) */}
                  <div className="flex flex-col items-center justify-center space-y-1.5 order-1 md:order-2 shrink-0">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      {isRtl ? 'مستند رسمي معتمد' : 'RECOGNIZED OFFICIAL DOCUMENT'}
                    </span>
                    <h2 className="text-base font-black bg-slate-100 dark:bg-slate-800/80 px-4 py-2 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 text-indigo-600 dark:text-cyan-400 mt-1 shadow-sm text-center">
                      {selectedInvoice.type === 'sale' 
                        ? (isRtl ? 'فاتورة ضريبية قانونية' : 'Tax Sales Invoice') 
                        : (isRtl ? 'فاتورة شراء مخزنية' : 'Warehouse Purchase Invoice')}
                    </h2>
                  </div>

                  {/* Left Header Side (System Branding) */}
                  <div className="space-y-1 text-center md:text-left text-xs text-slate-400 dark:text-slate-500 order-3 flex-1 w-full flex flex-col items-center md:items-end md:justify-start">
                    <span className="text-base font-black text-slate-900 dark:text-white tracking-tight">MOSTAWDAl</span>
                    <p className="text-[10px] font-bold tracking-wider">ENTERPRISE ERP</p>
                    <p className="text-[9px] mt-1 text-slate-450">{new Date(selectedInvoice.date).toLocaleTimeString(isRtl ? 'ar-JO' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              </div>

              {/* Dynamic Metadata & Information Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50 dark:bg-slate-950/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800/50 mb-8 select-none">
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">{isRtl ? 'رقم الفاتورة المرجعي:' : 'Invoice ID Number:'}</span>
                    <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400 text-sm">#{selectedInvoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">{isRtl ? 'تصنيف الصفقة المالية:' : 'Transaction Category:'}</span>
                    <span className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${selectedInvoice.type === 'sale' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'}`}>
                      {selectedInvoice.type === 'sale' ? (isRtl ? 'فاتورة مبيعات' : 'Sales Transaction') : (isRtl ? 'فاتورة مشتريات' : 'Purchase Ledger')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">{isRtl ? 'الرقم الضريبي الموحد للمنشأة:' : 'Registered Tax Registration ID:'}</span>
                    <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                      {settings?.taxRegistrationNumber || (isRtl ? 'غير متوفر' : 'Not Registered')}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 sm:border-r sm:border-slate-200 sm:dark:border-slate-800 sm:pr-6 sm:mr-6">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">{isRtl ? 'تاريخ المعاملة والتحرير:' : 'Issue Date & Time:'}</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {new Date(selectedInvoice.date).toLocaleDateString(isRtl ? 'ar-JO' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">{isRtl ? 'اليوم في التقويم:' : 'Calendar Day:'}</span>
                    <span className="font-black text-indigo-600 dark:text-indigo-400">
                      {isRtl ? (['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][new Date(selectedInvoice.date).getDay()]) : new Date(selectedInvoice.date).toLocaleDateString('en-US', { weekday: 'long' })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-450 dark:text-slate-500 font-bold">
                      {selectedInvoice.type === 'sale' ? (isRtl ? 'العميل المفوتر:' : 'Invoiced Customer:') : (isRtl ? 'المورد المسجل:' : 'Registered Supplier:')}
                    </span>
                    <span className="font-black text-slate-900 dark:text-white">
                      {selectedInvoice.customerName || selectedInvoice.supplierName || (isRtl ? 'زبون عام مجهول' : 'General Client/Walk-in')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Clean Data Table (الجدول الرقمي الموحد) */}
              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 mb-8">
                <table className="w-full text-inner-table">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 font-bold text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-4 px-5 text-right font-black uppercase tracking-wider">{isRtl ? 'الصنف التفصيلي' : 'Item Description'}</th>
                      <th className="py-4 px-5 text-center font-black uppercase tracking-wider w-24">{isRtl ? 'الكمية' : 'Qty'}</th>
                      <th className="py-4 px-5 text-center font-black uppercase tracking-wider w-32">{isRtl ? 'سعر الوحدة' : 'Unit Price'}</th>
                      <th className="py-4 px-5 text-left font-black uppercase tracking-wider w-36">{isRtl ? 'المجموع الإجمالي' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {selectedInvoice.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-4 px-5 text-right">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{item.description}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {item.productId.slice(0, 8)}</div>
                        </td>
                        <td className="py-4 px-5 text-center font-bold text-slate-900 dark:text-slate-100">{item.quantity}</td>
                        <td className="py-4 px-5 text-center font-mono text-slate-500 dark:text-slate-400">{formatCurrency(item.unitPrice, selectedInvoice.currency)}</td>
                        <td className="py-4 px-5 text-left font-mono font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(item.total, selectedInvoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary and Financial Calculations */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 items-start mb-10">
                {/* Notes Column */}
                <div className="p-5 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200 dark:border-slate-800 h-full">
                  <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2">{isRtl ? 'ملاحظات وشروط الفاتورة' : 'Invoice Notes'}</span>
                  <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed italic space-y-1">
                    <span>{isRtl ? '1. البضاعة المباعة لا ترد ولا تستبدل بعد مرور 3 أيام من تاريخ الشراء.' : '1. Goods sold can only be returned within 3 days of purchase.'}</span>
                    <br />
                    <span>{isRtl ? '2. تم تسجيل هذه المعاملة إلكترونياً وهي خاضعة لنظام المحاسبة المعتمد.' : '2. This invoice is registered digitally via automated secure ledgers.'}</span>
                  </p>
                </div>
                
                {/* Math Calculations */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center px-4 text-xs">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">{isRtl ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{formatCurrency(selectedInvoice.subtotal, selectedInvoice.currency)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 text-xs">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">{isRtl ? 'ضريبة القيمة المضافة' : 'VAT'} ({settings?.defaultVatRate || 16}%)</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{formatCurrency(selectedInvoice.taxAmount, selectedInvoice.currency)}</span>
                  </div>
                  <div className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 p-5 sm:p-6 rounded-2xl shadow-xl relative overflow-hidden">
                    <div className="relative z-10 flex justify-between items-center">
                      <span className="font-black uppercase tracking-widest text-xs opacity-75">{isRtl ? 'المجموع النهائي الكلي:' : 'GRAND TOTAL:'}</span>
                      <span className="text-2xl font-black font-mono">{formatCurrency(selectedInvoice.totalAmount, selectedInvoice.currency)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Verified Badge and Digital Signatures (الملاحظات والتوقيع) */}
              <div className="grid grid-cols-2 gap-6 pt-6 border-t border-dashed border-slate-200 dark:border-slate-800 text-center mb-6">
                <div className="space-y-4">
                  <span className="text-[11px] font-black text-slate-450 dark:text-slate-500 uppercase tracking-wider block">{isRtl ? 'توقيع المستلم / المشتري' : 'Buyer Signature'}</span>
                  <div className="h-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-300 text-[10px] italic">
                    {isRtl ? 'توقيع رسمي معتمد' : 'Authorized Signature'}
                  </div>
                </div>
                <div className="space-y-4">
                  <span className="text-[11px] font-black text-slate-450 dark:text-slate-500 uppercase tracking-wider block">{isRtl ? 'توقيع البائع / أمين المستودع' : 'Seller Signature'}</span>
                  <div className="h-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-300 text-[10px] italic">
                    {settings?.businessName || (isRtl ? 'ختم المنشأة' : 'Company Stamp')}
                  </div>
                </div>
              </div>
              
              {/* Minimal Printable Footer */}
              <div className="pt-6 border-t border-slate-200 dark:border-slate-800 text-center invoice-print-footer">
                <p className="text-slate-900 dark:text-white font-black text-sm tracking-tighter mb-1 select-none">{t.invoiceThankYou}</p>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest select-none">نظام مستودعي لإدارة المخازن والفواتير • 2026</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
