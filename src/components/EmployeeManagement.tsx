import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Mail, 
  Briefcase, 
  DollarSign, 
  Activity,
  Trash2,
  Edit2,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock
} from 'lucide-react';
import { Language, Employee, AppSettings, PayrollRecord, Currency } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import ContextMenu3D from './ContextMenu3D';
import useLongPress from '../hooks/useLongPress';
import { Eye, Printer, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { TactileButton } from './ui/TactileButton';
import { useSuccessCelebration } from '../hooks/useSuccessCelebration';
import { sounds } from '../lib/sounds';
import { CURRENCY_SYMBOLS, POS_CURRENCY_CODES, buildUsdUnitRates, convertMoney, formatMoney, readCachedLiveRates } from '../lib/exchangeRates';
import { roundForCurrency } from '../lib/vaultMath';

interface Props {
  language: Language;
  settings: AppSettings;
}

interface EmployeeCardProps {
  key?: string;
  emp: Employee;
  index: number;
  t: any;
  isRtl: boolean;
  settings: AppSettings;
  onEdit: (emp: Employee) => void;
  onDelete: (id: string) => void;
  onPaySalary: (emp: Employee) => void;
  onLongPress: (emp: Employee) => void;
}

function EmployeeCard({ emp, index, t, isRtl, settings, onEdit, onDelete, onPaySalary, onLongPress }: EmployeeCardProps) {
  const longPressProps = useLongPress(() => onLongPress(emp));

  return (
    <motion.div
      key={emp.id}
      {...longPressProps}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white dark:bg-gray-800 p-6 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-xl hover:shadow-indigo-50 dark:hover:shadow-indigo-900/10 transition-all group relative overflow-hidden select-none cursor-pointer"
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-2xl ${
          emp.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
          emp.status === 'on-leave' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
          'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
        }`}>
          <Briefcase size={24} />
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={(e) => { e.stopPropagation(); onEdit(emp); }}
            className="p-2 bg-gray-50 dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 text-gray-400 hover:text-indigo-600 rounded-lg transition-all"
          >
            <Edit2 size={16} />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(emp.id); }}
            className="p-2 bg-gray-50 dark:bg-gray-700 hover:bg-rose-50 dark:hover:bg-rose-900/50 text-gray-400 hover:text-rose-600 rounded-lg transition-all"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white truncate">{emp.name}</h3>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{emp.role}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-50 dark:border-gray-700">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.salary}</p>
            <div className="flex items-center gap-1 text-gray-900 dark:text-gray-100 font-bold">
              <span className="text-[10px] text-emerald-500 font-black">
                {CURRENCY_SYMBOLS[settings.currency || 'JOD'] || settings.currency}
              </span>
              <span className="font-mono">{emp.salary.toLocaleString()}</span>
            </div>
          </div>
          <div className="space-y-1 text-right">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.employeeStatus}</p>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full inline-block ${
              emp.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
              emp.status === 'on-leave' ? 'bg-amber-100 text-amber-700' :
              'bg-rose-100 text-rose-700'
            }`}>
              {t[emp.status as keyof typeof t]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 pt-2">
          <Mail size={14} />
          <span className="truncate">{emp.contact || 'No contact info'}</span>
        </div>
        
        <div className="flex items-center gap-3 text-[10px] font-bold text-gray-400 pt-1">
          <Clock size={12} />
          <span>Joined: {new Date(emp.hiredDate).toLocaleDateString()}</span>
        </div>

        <div className="pt-4">
          <TactileButton
            onClick={(e) => { e.stopPropagation(); onPaySalary(emp); }}
            disabled={emp.status !== 'active'}
            variant={emp.status === 'active' ? 'secondary' : 'ghost'}
            fullWidth
            className={`text-[10px] uppercase tracking-widest ${
              emp.status !== 'active' ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            <DollarSign size={14} />
            {t.paySalary}
          </TactileButton>
        </div>
      </div>
    </motion.div>
  );
}

export default function EmployeeManagement({ language, settings }: Props) {
  const { employees, payrollRecords, saveEmployee, deleteEmployee, savePayrollRecord, payPayroll, deletePayrollRecord } = useFirebase();
  const { celebrationClass, triggerCelebration } = useSuccessCelebration();
  const [activeTab, setActiveTab] = useState<'employees' | 'payroll'>('employees');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<Employee | null>(null);
  
  // Salary payment workflow state with Glassmorphism dialog & loading safeguards
  const [selectedPayEmployee, setSelectedPayEmployee] = useState<Employee | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [payrollCurrency, setPayrollCurrency] = useState<Currency>(settings.currency || 'JOD');

  // States for detailed payroll/payslip configuration
  const [payrollMonthYear, setPayrollMonthYear] = useState('');
  const [payrollAllowances, setPayrollAllowances] = useState(0);
  const [payrollDeductions, setPayrollDeductions] = useState(0);
  const [payrollStatus, setPayrollStatus] = useState<'paid' | 'pending'>('paid');

  useEffect(() => {
    setPayrollCurrency(settings.currency || 'JOD');
  }, [settings.currency]);

  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    contact: '',
    salary: 0,
    status: 'active'
  });

  const t = translations[language];
  const isRtl = language === 'ar';

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.role) return;

    if ((formData.salary || 0) < 0) {
      toast.error(isRtl ? 'لا يمكن إدخال راتب سالب' : 'Salary cannot be negative');
      return;
    }

    const employeeToSave: Employee = {
      id: editingEmployee?.id || Math.random().toString(36).substring(7),
      name: formData.name,
      role: formData.role,
      contact: formData.contact || '',
      salary: Number(formData.salary) || 0,
      status: formData.status as any,
      hiredDate: editingEmployee?.hiredDate || Date.now()
    };

    await saveEmployee(employeeToSave);
    triggerCelebration();
    toast.success(editingEmployee ? (isRtl ? 'تم تحديث بيانات الموظف' : 'Employee updated') : (isRtl ? 'تمت إضافة الموظف بنجاح' : 'Employee added successfully'));
    setIsModalOpen(false);
    resetForm();
  };

  // Opens the Glassmorphism confirmation dialog and plays futuristic tactile audio
  const handlePaySalary = (emp: Employee) => {
    sounds.playClick();
    setSelectedPayEmployee(emp);
    setPayrollCurrency(settings.currency || 'JOD');
    
    // Auto-prepopulate Month/Year as YYYY-MM
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    const currentYear = today.getFullYear();
    setPayrollMonthYear(`${currentYear}-${currentMonth}`);
    setPayrollAllowances(0);
    setPayrollDeductions(0);
    setPayrollStatus('paid');
  };

  const currencySymbol = (code: Currency) => {
    switch (code) {
      case 'JOD': return 'د.أ';
      case 'USD': return '$';
      case 'ILS': return '₪';
      case 'IQD': return 'ع.د';
      case 'SAR': return 'ر.س';
      case 'LYD': return 'ل.د';
      default: return code;
    }
  };

  // Totals are kept per currency (never summed across currencies)
  const payrollTotalsText = (status: 'paid' | 'pending'): string => {
    const totals: Record<string, number> = {};
    payrollRecords.filter(r => r.paymentStatus === status).forEach(r => {
      const cur = r.currency || settings.currency || 'JOD';
      totals[cur] = (totals[cur] || 0) + (Number(r.netSalary) || 0);
    });
    const parts = Object.entries(totals).filter(([, v]) => v !== 0).map(([cur, v]) => formatMoney(v, cur, isRtl ? 'ar' : 'en-US'));
    return parts.length ? parts.join('  •  ') : formatMoney(0, settings.currency || 'JOD', isRtl ? 'ar' : 'en-US');
  };

  // Employee salaries are stored in the business currency; paying in another currency converts the basic salary.
  const baseSalaryIn = (emp: Employee, target: Currency): number => {
    const from = (settings.currency || 'JOD') as Currency;
    const salary = Number(emp.salary) || 0;
    if (from === target) return salary;
    const converted = convertMoney(salary, from as any, target as any, buildUsdUnitRates(settings, readCachedLiveRates()));
    return roundForCurrency(converted, target);
  };

  const payrollErrorMessage = (error: any): string => {
    const msg = String(error?.message || '');
    if (msg.startsWith('Insufficient vault funds')) {
      return isRtl ? 'رصيد الخزنة بهذه العملة غير كافٍ لصرف الراتب. أضف رصيداً للخزنة أولاً.' : 'Not enough balance in the vault for this currency. Deposit funds first.';
    }
    if (msg === 'Payroll already paid') return isRtl ? 'هذا الراتب مصروف مسبقاً.' : 'This payroll was already paid.';
    if (msg.startsWith('No active session')) return isRtl ? 'سجّل الدخول بحساب حقيقي لصرف الرواتب (وضع الضيف للمعاينة فقط).' : 'Sign in with a real account to pay salaries (guest mode is preview only).';
    return t.error;
  };

  // Safe salary payment with single-submission lock to prevent double payments
  const handleConfirmPayment = async () => {
    if (!selectedPayEmployee) return;
    setIsPaying(true);
    try {
      const netSalary = roundForCurrency(baseSalaryIn(selectedPayEmployee, payrollCurrency) + (Number(payrollAllowances) || 0) - (Number(payrollDeductions) || 0), payrollCurrency);

      const payrollToSave: PayrollRecord = {
        id: Math.random().toString(36).substring(7),
        employeeId: selectedPayEmployee.id,
        employeeName: selectedPayEmployee.name,
        monthYear: payrollMonthYear || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        allowances: Number(payrollAllowances) || 0,
        deductions: Number(payrollDeductions) || 0,
        netSalary: netSalary,
        paymentDate: Date.now(),
        paymentStatus: payrollStatus,
        currency: payrollCurrency
      };

      if (payrollStatus === 'paid') {
        if (netSalary <= 0) {
          toast.error(isRtl ? 'صافي الراتب يجب أن يكون أكبر من صفر' : 'Net salary must be greater than zero');
          return;
        }
        // Atomic: payroll record + vault expense are written together
        await payPayroll(payrollToSave);
      } else {
        await savePayrollRecord(payrollToSave);
      }

      triggerCelebration();
      toast.success(payrollStatus === 'paid' ? t.paymentRecorded : (isRtl ? 'تم تسجيل مسير الراتب بانتظار الصرف' : 'Payroll saved as pending payment'));
      setSelectedPayEmployee(null);
    } catch (error: any) {
      toast.error(payrollErrorMessage(error));
    } finally {
      setIsPaying(false);
    }
  };

  const handleMarkAsPaid = async (record: PayrollRecord) => {
    sounds.playClick();
    if (isPaying) return;
    setIsPaying(true);
    try {
      await payPayroll({ ...record, currency: record.currency || settings.currency || 'JOD' });
      triggerCelebration();
      toast.success(isRtl ? 'تم صرف الراتب وتحديث الحالة بنجاح' : 'Salary processed and status updated successfully!');
    } catch (error: any) {
      toast.error(payrollErrorMessage(error));
    } finally {
      setIsPaying(false);
    }
  };

  const handleDeletePayroll = async (id: string) => {
    sounds.playClick();
    const target = payrollRecords.find(p => p.id === id);
    const isPaidRecord = target?.paymentStatus === 'paid';
    const confirmMsg = isPaidRecord
      ? (isRtl ? 'هذا الراتب مصروف من الخزنة. حذف السجل سيعيد المبلغ إلى الخزنة بقيد عكسي. هل تريد المتابعة؟' : 'This salary was paid from the vault. Deleting the record returns the amount to the vault with a reversal entry. Continue?')
      : (isRtl ? 'هل أنت متأكد من حذف هذا السجل للمسير الرواتب؟' : 'Are you sure you want to delete this payroll record?');
    if (window.confirm(confirmMsg)) {
      try {
        await deletePayrollRecord(id);
        toast.success(isRtl ? 'تم حذف مسير الراتب بنجاح' : 'Payroll record deleted successfully');
      } catch (e) {
        toast.error(t.error);
      }
    }
  };
  const resetForm = () => {
    setFormData({ name: '', role: '', contact: '', salary: 0, status: 'active' });
    setEditingEmployee(null);
  };

  const handleEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormData(emp);
    setIsModalOpen(true);
  };

  return (
    <div className={`max-w-7xl mx-auto p-4 sm:p-6 space-y-8 notranslate ${isRtl ? 'font-arabic' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <ContextMenu3D 
        isOpen={!!contextMenuTarget}
        onClose={() => setContextMenuTarget(null)}
        title={contextMenuTarget?.name || ''}
        subtitle={contextMenuTarget?.role}
        language={language}
        details={[
          { label: t.salary, value: formatMoney(contextMenuTarget?.salary || 0, settings.currency || 'JOD') },
          { label: t.employeeStatus, value: contextMenuTarget ? t[contextMenuTarget.status as keyof typeof t] : '' },
          { label: t.contact, value: contextMenuTarget?.contact || 'N/A' },
          { label: t.date, value: contextMenuTarget ? new Date(contextMenuTarget.hiredDate).toLocaleDateString() : '' }
        ]}
        actions={[
          { id: 'view', label: t.view, icon: <Eye size={18}/>, onClick: () => { toast.info(isRtl ? 'عرض ملف الموظف غير متاح حالياً' : 'Employee profile view not available yet'); setContextMenuTarget(null); } },
          { id: 'edit', label: t.editEmployee, icon: <Edit2 size={18}/>, onClick: () => { handleEdit(contextMenuTarget!); setContextMenuTarget(null); } },
          { id: 'pay', label: t.paySalary, icon: <DollarSign size={18}/>, onClick: () => { handlePaySalary(contextMenuTarget!); setContextMenuTarget(null); } },
          { id: 'call', label: t.contact, icon: <Phone size={18}/>, onClick: () => { if (contextMenuTarget?.contact) window.location.href = `tel:${contextMenuTarget.contact}`; setContextMenuTarget(null); } },
          { id: 'delete', label: t.actions, color: 'rose', icon: <Trash2 size={18}/>, onClick: () => { deleteEmployee(contextMenuTarget!.id); setContextMenuTarget(null); } }
        ]}
      />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t.employees}</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t.hrSummary}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab Switcher */}
          <div className="flex bg-gray-100 dark:bg-gray-800/60 p-1 rounded-xl border border-gray-200/50 dark:border-gray-700/50">
            <button
              type="button"
              onClick={() => { sounds.playClick(); setActiveTab('employees'); }}
              className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all duration-300 flex items-center gap-1.5 ${
                activeTab === 'employees'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <Users size={14} />
              {isRtl ? 'الموظفين' : 'Employees'}
            </button>
            <button
              type="button"
              onClick={() => { sounds.playClick(); setActiveTab('payroll'); }}
              className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all duration-300 flex items-center gap-1.5 ${
                activeTab === 'payroll'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <DollarSign size={14} />
              {isRtl ? 'كشف الرواتب' : 'Payroll Ledger'}
            </button>
          </div>

          <TactileButton
            onClick={() => setIsModalOpen(true)}
          >
            <UserPlus size={20} />
            {t.addEmployee}
          </TactileButton>
        </div>
      </div>

      {/* Search and Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6">
          <div className="relative">
            <Search size={20} className={`absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-4' : 'left-4'} text-gray-400`} />
            <input
              type="text"
              placeholder={activeTab === 'employees' ? t.searchPlaceholder : (isRtl ? 'البحث باسم الموظف أو الفترة...' : 'Search by employee or period...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${isRtl ? 'pr-12 pl-4' : 'pl-12 pr-4'} py-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm dark:text-white transition-all`}
            />
          </div>
        </div>

        {activeTab === 'employees' ? (
          <>
            <div className="lg:col-span-3 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                  <Users size={20} />
                </div>
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{t.totalItems}</span>
              </div>
              <span className="text-xl font-black text-gray-900 dark:text-white">{employees.length}</span>
            </div>
            <div className="lg:col-span-3 salary-card-layout glass-card-test">
              <h3>{isRtl ? 'إجمالي الرواتب الأساسية' : 'Total Basic Salaries'}</h3>
              <p>{formatMoney(employees.reduce((acc, emp) => acc + (Number(emp.salary) || 0), 0), settings.currency || 'JOD', isRtl ? 'ar' : 'en-US')}</p>
            </div>
          </>
        ) : (
          <>
            <div className="lg:col-span-3 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={20} />
                </div>
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{isRtl ? 'إجمالي المصروف' : 'Total Paid'}</span>
              </div>
              <span className="text-xl font-mono font-black text-emerald-600 dark:text-emerald-400 text-end">
                {payrollTotalsText('paid')}
              </span>
            </div>
            <div className="lg:col-span-3 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-amber-600 dark:text-amber-400">
                  <Clock size={20} />
                </div>
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{isRtl ? 'المسيرات المعلقة' : 'Pending Obligations'}</span>
              </div>
              <span className="text-xl font-mono font-black text-amber-600 dark:text-amber-400 text-end">
                {payrollTotalsText('pending')}
              </span>
            </div>
          </>
        )}
      </div>

      {activeTab === 'employees' ? (
        /* Employee Grid */
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${celebrationClass}`}>
          <AnimatePresence>
            {filteredEmployees.map((emp, index) => (
              <EmployeeCard
                key={emp.id}
                emp={emp}
                index={index}
                t={t}
                isRtl={isRtl}
                settings={settings}
                onEdit={handleEdit}
                onDelete={deleteEmployee}
                onPaySalary={handlePaySalary}
                onLongPress={setContextMenuTarget}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        /* Payroll Table Ledger */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-150 dark:border-gray-700 shadow-sm overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" dir={isRtl ? 'rtl' : 'ltr'}>
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900/40 text-[11px] font-extrabold uppercase tracking-widest text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className={`py-4 px-6 ${isRtl ? 'text-right' : 'text-left'}`}>{isRtl ? 'اسم الموظف' : 'Employee'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'الفترة (الشهر)' : 'Period'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'علاوات (+)' : 'Allowances'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'خصومات (-)' : 'Deductions'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'صافي الراتب' : 'Net Salary'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'تاريخ الدفع' : 'Payment Code'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'حالة الصرف' : 'Status'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'إجراء' : 'Cancel'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {payrollRecords.filter(record => 
                  record.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                  record.monthYear.includes(searchQuery)
                ).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400 dark:text-gray-500 font-bold">
                      {isRtl ? 'لا توجد سجلات رواتب ومسيرات مدخلة بعد' : 'No payroll records registered in the system yet.'}
                    </td>
                  </tr>
                ) : (
                  payrollRecords.filter(record => 
                    record.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                    record.monthYear.includes(searchQuery)
                  ).map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                      <td className={`py-4 px-6 font-extrabold text-gray-900 dark:text-white ${isRtl ? 'text-right' : 'text-left'}`}>
                        {record.employeeName}
                      </td>
                      <td className="py-4 px-6 text-center text-gray-500 dark:text-gray-400 font-bold font-mono">
                        {record.monthYear}
                      </td>
                      <td className="py-4 px-6 text-center text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                        +{currencySymbol(record.currency || settings.currency || 'JOD')}{record.allowances.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-center text-rose-500 dark:text-rose-400 font-mono font-bold">
                        -{currencySymbol(record.currency || settings.currency || 'JOD')}{record.deductions.toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-center text-indigo-600 dark:text-indigo-400 font-mono font-black text-md">
                        {formatMoney(record.netSalary, record.currency || settings.currency || 'JOD', isRtl ? 'ar' : 'en-US')}
                      </td>
                      <td className="py-4 px-6 text-center text-xs text-gray-400 font-mono">
                        {new Date(record.paymentDate).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {record.paymentStatus === 'paid' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-xs font-black rounded-lg">
                            <CheckCircle2 size={12} />
                            {isRtl ? 'تم الصرف' : 'Paid'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleMarkAsPaid(record)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 hover:text-amber-700 text-xs font-black rounded-lg transition-all shadow-sm border border-amber-200/50"
                          >
                            <Clock size={12} className="animate-spin" style={{ animationDuration: '3s' }} />
                            {isRtl ? 'إتمام الدفع' : 'Pay Slip'}
                          </button>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeletePayroll(record.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all cursor-pointer"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsModalOpen(false); resetForm(); }}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-[2.5rem] shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-700"
            >
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="flex items-center gap-4 mb-2">
                  <div className="p-3 bg-indigo-600 rounded-2xl text-white">
                    <UserPlus size={24} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {editingEmployee ? t.editEmployee : t.addEmployee}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t.hrSummary}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t.employeeName}</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t.role}</label>
                      <input
                        required
                        type="text"
                        value={formData.role}
                        onChange={(e) => setFormData({...formData, role: e.target.value})}
                        className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t.salary} ({CURRENCY_SYMBOLS[settings.currency || 'JOD'] || settings.currency})</label>
                      <input
                        type="number"
                        value={formData.salary}
                        onChange={(e) => setFormData({...formData, salary: Number(e.target.value)})}
                        className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t.contact}</label>
                    <input
                      type="text"
                      value={formData.contact}
                      onChange={(e) => setFormData({...formData, contact: e.target.value})}
                      className="w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t.employeeStatus}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['active', 'on-leave', 'terminated'].map(status => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setFormData({...formData, status: status as any})}
                          className={`py-2.5 rounded-xl border-2 font-bold text-[10px] uppercase tracking-widest transition-all ${
                            formData.status === status
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                              : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 hover:border-gray-200'
                          }`}
                        >
                          {t[status as keyof typeof t]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <TactileButton
                    type="button"
                    variant="secondary"
                    fullWidth
                    onClick={() => { setIsModalOpen(false); resetForm(); }}
                  >
                    {t.cancel}
                  </TactileButton>
                  <TactileButton
                    type="submit"
                    fullWidth
                  >
                    {t.saveEmployee}
                  </TactileButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upgraded Glassmorphic Salary Payment configuration Modal */}
      <AnimatePresence>
        {selectedPayEmployee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            {/* Backdrop with heavy blur */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (!isPaying) setSelectedPayEmployee(null); }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
            />
            {/* Modal Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="relative w-full max-w-lg backdrop-blur-2xl bg-white/80 dark:bg-slate-900/80 border border-white/20 dark:border-slate-800/50 rounded-[2.5rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8),inset_0_1px_0px_rgba(255,255,255,0.1)] overflow-hidden p-8 text-center space-y-6"
            >
              {/* Outer 3D reflection border */}
              <div className="absolute inset-0 rounded-[2.5rem] border border-white/30 dark:border-white/5 pointer-events-none" />

              {/* Glowing animated visual header */}
              <div className="mx-auto w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20 relative group">
                <DollarSign size={24} className="animate-pulse" />
                <span className="absolute inset-0 rounded-full bg-cyan-400/30 blur-md scale-110 -z-10 animate-pulse" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                  {isRtl ? 'مسير رواتب الموظف' : 'Employee Payroll Configuration'}
                </h3>
                <p className="text-indigo-600 dark:text-indigo-400 font-extrabold text-sm">
                  {selectedPayEmployee.name} ({selectedPayEmployee.role})
                </p>
              </div>

              {/* Multi-field Setup */}
              <div className="space-y-4 text-left" dir={isRtl ? 'rtl' : 'ltr'}>
                {/* Month Year Period */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {isRtl ? 'فترة الراتب (الشهر والسنة)' : 'Salary Period (Month/Year)'}
                  </label>
                  <input
                    type="month"
                    value={payrollMonthYear}
                    onChange={(e) => setPayrollMonthYear(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-white text-center font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Allowances */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      {isRtl ? 'علاوات وإضافات' : 'Allowances / Additions'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={payrollAllowances}
                      onChange={(e) => setPayrollAllowances(Number(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm dark:text-white font-bold"
                    />
                  </div>

                  {/* Deductions */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                      {isRtl ? 'استقطاعات وخصومات' : 'Deductions'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={payrollDeductions}
                      onChange={(e) => setPayrollDeductions(Number(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm dark:text-white font-bold"
                    />
                  </div>
                </div>

                {/* Currency Selector */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {isRtl ? 'نوع العملة' : 'Currency'}
                  </label>
                  <select
                    value={payrollCurrency}
                    onChange={(e) => setPayrollCurrency(e.target.value as Currency)}
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-white font-bold"
                  >
                    {POS_CURRENCY_CODES.map((curr) => (
                      <option key={curr} value={curr}>{curr}</option>
                    ))}
                  </select>
                </div>

                {/* Payment Status Switcher */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {isRtl ? 'حالة الصرف والمسير' : 'Salary Payment Status'}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayrollStatus('paid')}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                        payrollStatus === 'paid'
                          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                          : 'border-gray-150 dark:border-gray-800 bg-white/30 dark:bg-gray-950/30 text-gray-400'
                      }`}
                    >
                      {isRtl ? 'صرف فوري وخصم من الخزنة' : 'Paid Immediately'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayrollStatus('pending')}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                        payrollStatus === 'pending'
                          ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400'
                          : 'border-gray-150 dark:border-gray-800 bg-white/30 dark:bg-gray-950/30 text-gray-400'
                      }`}
                    >
                      {isRtl ? 'تعليق في المسير (Unpaid)' : 'Pending / Unpaid'}
                    </button>
                  </div>
                </div>

                {/* Detailed Invoice Breakdown */}
                <div className="p-4 bg-gray-50 dark:bg-gray-950 border border-gray-150/50 dark:border-gray-800/80 rounded-2xl space-y-2 mt-4">
                  <div className="flex justify-between text-xs font-bold text-gray-500 dark:text-gray-400">
                    <span>{isRtl ? 'الراتب الأساسي' : 'Basic Salary'}</span>
                    <span className="font-mono">
                      {formatMoney(baseSalaryIn(selectedPayEmployee, payrollCurrency), payrollCurrency, isRtl ? 'ar' : 'en-US')}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>{isRtl ? 'علاوات وإضافات (+)' : 'Allowances (+)'}</span>
                    <span className="font-mono">+{payrollAllowances}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-rose-500 dark:text-rose-400">
                    <span>{isRtl ? 'استقطاعات وخصومات (-)' : 'Deductions (-)'}</span>
                    <span className="font-mono">-{payrollDeductions}</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-800/80 pt-2 flex justify-between items-center text-sm font-black text-indigo-600 dark:text-indigo-400">
                    <span>{isRtl ? 'صافي المبلغ النهائي' : 'Estimated Net Pay'}</span>
                    <span className="text-lg font-mono">
                      {formatMoney(baseSalaryIn(selectedPayEmployee, payrollCurrency) + Number(payrollAllowances) - Number(payrollDeductions), payrollCurrency, isRtl ? 'ar' : 'en-US')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => { setSelectedPayEmployee(null); sounds.playClick(); }}
                  className="w-full py-3 px-6 bg-slate-200/50 hover:bg-slate-200/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200 border border-slate-300/30 dark:border-slate-700/30 rounded-2xl font-bold uppercase tracking-widest text-xs transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-inner"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={handleConfirmPayment}
                  className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold uppercase tracking-widest text-xs rounded-2xl shadow-[0_10px_20px_rgba(6,182,212,0.25)] dark:shadow-[0_10px_20px_rgba(6,182,212,0.35)] transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0 relative overflow-hidden"
                >
                  {isPaying ? (isRtl ? 'جاري الحفظ...' : 'Processing...') : (isRtl ? 'حفظ وصرف المسير' : 'Process & Save')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
