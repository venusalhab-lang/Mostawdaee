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
  Clock,
  X
} from 'lucide-react';
import { Language, Employee, AppSettings, PayrollRecord, Currency } from '../types';
import { translations } from '../translations';
import { motion, AnimatePresence } from 'motion/react';
import { useFirebase } from './FirebaseProvider';
import ContextMenu3D from './ContextMenu3D';
import useLongPress from '../hooks/useLongPress';
import { Printer, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { TactileButton } from './ui/TactileButton';
import { useSuccessCelebration } from '../hooks/useSuccessCelebration';
import { sounds } from '../lib/sounds';
import { matchesQuery, phoneMatches } from '../lib/search';
import { useScreenSearch } from '../lib/screenSearch';
import { conversionBasis, formatMoney, isPosCurrency, readCachedLiveRates, readCachedLiveRatesTimestamp } from '../lib/exchangeRates';
import { usePreferredCurrency } from './CurrencyContext';
import { CurrencySelect } from './CurrencyPicker';
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

// Stored as 'on-leave'; the translation key is camelCase.
const statusLabel = (t: any, status: string) => (status === 'on-leave' ? t.onLeave : t[status]) || status;

// A sheet from the bottom on phones, a centred card on wider screens. Only the body scrolls,
// so the title and the actions stay in view and above the bottom navigation bar.
const SHEET_OVERLAY = 'fixed inset-0 z-[500] flex items-end sm:items-center justify-center sm:p-4';
const SHEET_PANEL = 'relative w-full sm:max-w-lg max-h-[92dvh] sm:max-h-[90dvh] flex flex-col bg-white dark:bg-gray-800 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden';
const SHEET_HEADER = 'shrink-0 flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-700';
const SHEET_BODY = 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 space-y-5';
const SHEET_FOOTER = 'shrink-0 flex gap-3 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 dark:border-gray-700';
const FIELD_LABEL = 'block text-sm font-bold text-gray-700 dark:text-gray-300';
const FIELD_INPUT = 'w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white';

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(emp); }}
            className="p-2.5 bg-gray-50 dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 text-gray-500 hover:text-indigo-600 rounded-xl transition-all"
            aria-label={isRtl ? `تعديل ${emp.name}` : `Edit ${emp.name}`}>
            <Edit2 size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(emp.id); }}
            className="p-2.5 bg-gray-50 dark:bg-gray-700 hover:bg-rose-50 dark:hover:bg-rose-900/50 text-gray-500 hover:text-rose-600 rounded-xl transition-all"
            aria-label={isRtl ? `حذف ${emp.name}` : `Delete ${emp.name}`}>
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
            <p className="text-xs font-bold text-gray-400">{t.salary}</p>
            <div className="text-gray-900 dark:text-gray-100 font-bold font-mono">
              {formatMoney(emp.salary, isPosCurrency(emp.currency) ? emp.currency : (isPosCurrency(settings.currency) ? settings.currency : 'JOD'), isRtl ? 'ar' : 'en-US')}
            </div>
          </div>
          <div className="space-y-1 text-end">
            <p className="text-xs font-bold text-gray-400">{t.employeeStatus}</p>
            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full inline-block ${
              emp.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
              emp.status === 'on-leave' ? 'bg-amber-100 text-amber-700' :
              'bg-rose-100 text-rose-700'
            }`}>
              {statusLabel(t, emp.status)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 pt-2">
          {emp.contact?.includes('@') ? <Mail size={14} /> : <Phone size={14} />}
          <span className="truncate" dir={emp.contact ? 'ltr' : undefined}>
            {emp.contact || (isRtl ? 'لا توجد بيانات اتصال' : 'No contact info')}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-bold text-gray-400 pt-1">
          <Clock size={12} />
          <span>
            {isRtl ? 'تاريخ التعيين: ' : 'Hired: '}
            {new Date(emp.hiredDate).toLocaleDateString(isRtl ? 'ar' : 'en-US')}
          </span>
        </div>

        <div className="pt-4">
          <TactileButton
            onClick={(e) => { e.stopPropagation(); onPaySalary(emp); }}
            disabled={emp.status !== 'active'}
            variant={emp.status === 'active' ? 'secondary' : 'ghost'}
            fullWidth
            className={`text-sm ${
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
  const { preferredCurrency } = usePreferredCurrency();
  const systemCurrency: Currency = isPosCurrency(preferredCurrency)
    ? preferredCurrency
    : (isPosCurrency(settings.currency) ? settings.currency : 'JOD');
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
    currency: systemCurrency,
    status: 'active'
  });

  const t = translations[language];
  const isRtl = language === 'ar';

  const filteredEmployees = employees.filter(emp =>
    matchesQuery([emp.name, emp.role], searchQuery) || phoneMatches(emp.contact, searchQuery)
  );

  useScreenSearch('employees', ({ query }) => {
    setActiveTab('employees');
    setSearchQuery(query);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.role) return;

    if ((formData.salary || 0) < 0) {
      toast.error(isRtl ? 'لا يمكن إدخال راتب سالب' : 'Salary cannot be negative');
      return;
    }

    const salaryCurrency = isPosCurrency(formData.currency) ? formData.currency : systemCurrency;
    const currencyLocked = !!editingEmployee && payrollRecords.some(record => record.employeeId === editingEmployee.id);
    const employeeToSave: Employee = {
      id: editingEmployee?.id || crypto.randomUUID(),
      name: formData.name,
      role: formData.role,
      contact: formData.contact || '',
      salary: Number(formData.salary) || 0,
      currency: currencyLocked && isPosCurrency(editingEmployee?.currency) ? editingEmployee.currency : salaryCurrency,
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
    setPayrollCurrency(isPosCurrency(emp.currency) ? emp.currency : systemCurrency);
    
    // Auto-prepopulate Month/Year as YYYY-MM
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    const currentYear = today.getFullYear();
    setPayrollMonthYear(`${currentYear}-${currentMonth}`);
    setPayrollAllowances(0);
    setPayrollDeductions(0);
    setPayrollStatus('paid');
  };

  const money = (amount: number, code?: string) =>
    formatMoney(amount, code || settings.currency || 'JOD', isRtl ? 'ar' : 'en-US');

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

  const salaryCurrencyOf = (emp: { currency?: string }): Currency =>
    isPosCurrency(emp.currency) ? emp.currency : systemCurrency;

  // The stored salary is in the employee's currency. Paying in another currency converts that amount.
  const salaryBasis = (emp: Employee, target: Currency) =>
    conversionBasis(salaryCurrencyOf(emp), target, settings, readCachedLiveRates(), readCachedLiveRatesTimestamp());

  const baseSalaryIn = (emp: Employee, target: Currency): number => {
    const from = salaryCurrencyOf(emp);
    const salary = Number(emp.salary) || 0;
    if (from === target) return salary;
    return roundForCurrency(salary * salaryBasis(emp, target).rate, target);
  };
  const payRateMissing = !!selectedPayEmployee && !salaryBasis(selectedPayEmployee, payrollCurrency).ok;

  const payrollErrorMessage = (error: any): string => {
    const msg = String(error?.message || '');
    if (msg.startsWith('Insufficient vault funds')) {
      return isRtl ? 'رصيد الخزنة بهذه العملة غير كافٍ لصرف الراتب. أضف رصيداً للخزنة أولاً.' : 'Not enough balance in the vault for this currency. Deposit funds first.';
    }
    if (msg === 'Payroll already paid') return isRtl ? 'راتب هذا الموظف لهذا الشهر مصروف مسبقاً.' : "This employee's salary for this month was already paid.";
    return t.error;
  };

  // Safe salary payment with single-submission lock to prevent double payments
  const handleConfirmPayment = async () => {
    if (!selectedPayEmployee || payRateMissing) return;
    setIsPaying(true);
    try {
      const allowances = roundForCurrency(Math.max(0, Number(payrollAllowances) || 0), payrollCurrency);
      const deductions = roundForCurrency(Math.max(0, Number(payrollDeductions) || 0), payrollCurrency);
      const netSalary = roundForCurrency(baseSalaryIn(selectedPayEmployee, payrollCurrency) + allowances - deductions, payrollCurrency);

      const monthYear = payrollMonthYear || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      // Records saved before ids were per month are matched by employee and month.
      if (payrollRecords.some((r) => r.employeeId === selectedPayEmployee.id && r.monthYear === monthYear && r.paymentStatus === 'paid')) {
        throw new Error('Payroll already paid');
      }
      const payrollToSave: PayrollRecord = {
        // One payroll per employee per month: a second payment for the same month is refused.
        id: `${selectedPayEmployee.id}_${monthYear}`,
        employeeId: selectedPayEmployee.id,
        employeeName: selectedPayEmployee.name,
        monthYear,
        allowances,
        deductions,
        netSalary: netSalary,
        paymentDate: Date.now(),
        paymentStatus: payrollStatus,
        currency: payrollCurrency
      };

      if (netSalary < 0) {
        toast.error(isRtl ? 'الخصومات أكبر من الراتب والعلاوات' : 'Deductions exceed salary plus allowances');
        return;
      }
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
      if (!error?.notified) toast.error(payrollErrorMessage(error));
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
      if (!error?.notified) toast.error(payrollErrorMessage(error));
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
      : (isRtl ? 'هل تريد حذف سجل الراتب هذا؟' : 'Delete this payroll record?');
    if (window.confirm(confirmMsg)) {
      try {
        await deletePayrollRecord(id);
        toast.success(isRtl ? 'تم حذف مسير الراتب بنجاح' : 'Payroll record deleted successfully');
      } catch (e) {
        toast.error(t.error);
      }
    }
  };
  const handleDeleteEmployee = async (id: string) => {
    const target = employees.find((emp) => emp.id === id);
    const name = target?.name || '';
    const confirmMsg = isRtl
      ? `حذف الموظف «${name}»؟ تبقى سجلات رواتبه السابقة في كشف الرواتب.`
      : `Delete employee "${name}"? Their past payroll records stay in the ledger.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteEmployee(id);
      toast.success(isRtl ? 'تم حذف الموظف' : 'Employee deleted');
    } catch (error: any) {
      if (!error?.notified) toast.error(t.error);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', role: '', contact: '', salary: 0, currency: systemCurrency, status: 'active' });
    setEditingEmployee(null);
  };

  const searchLabel = activeTab === 'employees'
    ? (isRtl ? 'ابحث بالاسم أو الوظيفة أو الهاتف...' : 'Search by name, role or phone...')
    : (isRtl ? 'ابحث باسم الموظف أو الفترة...' : 'Search by employee or period...');

  const closeEmployeeForm = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const salaryCurrencyLocked = !!editingEmployee && payrollRecords.some((record) => record.employeeId === editingEmployee.id);

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
          { label: t.salary, value: formatMoney(contextMenuTarget?.salary || 0, contextMenuTarget ? salaryCurrencyOf(contextMenuTarget) : systemCurrency) },
          { label: t.employeeStatus, value: contextMenuTarget ? statusLabel(t, contextMenuTarget.status) : '' },
          { label: t.contact, value: contextMenuTarget?.contact || (isRtl ? 'لا يوجد' : 'None') },
          { label: isRtl ? 'تاريخ التعيين' : 'Hired', value: contextMenuTarget ? new Date(contextMenuTarget.hiredDate).toLocaleDateString(isRtl ? 'ar' : 'en-US') : '' }
        ]}
        actions={[
          { id: 'edit', label: t.editEmployee, icon: <Edit2 size={18}/>, onClick: () => { handleEdit(contextMenuTarget!); setContextMenuTarget(null); } },
          ...(contextMenuTarget?.status === 'active'
            ? [{ id: 'pay', label: t.paySalary, icon: <DollarSign size={18}/>, onClick: () => { handlePaySalary(contextMenuTarget!); setContextMenuTarget(null); } }]
            : []),
          ...(contextMenuTarget?.contact && !contextMenuTarget.contact.includes('@')
            ? [{ id: 'call', label: isRtl ? 'اتصال' : 'Call', icon: <Phone size={18}/>, onClick: () => { window.location.href = `tel:${contextMenuTarget!.contact.replace(/\s+/g, '')}`; setContextMenuTarget(null); } }]
            : []),
          { id: 'delete', label: isRtl ? 'حذف الموظف' : 'Delete employee', color: 'rose', icon: <Trash2 size={18}/>, onClick: () => { const id = contextMenuTarget!.id; setContextMenuTarget(null); void handleDeleteEmployee(id); } }
        ]}
      />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t.employees}</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t.hrSummary}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex bg-gray-100 dark:bg-gray-800/60 p-1 rounded-xl border border-gray-200/50 dark:border-gray-700/50" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'employees'}
              onClick={() => { sounds.playClick(); setActiveTab('employees'); }}
              className={`flex-1 sm:flex-none whitespace-nowrap px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 flex items-center justify-center gap-1.5 ${
                activeTab === 'employees'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <Users size={14} />
              {isRtl ? 'الموظفون' : 'Employees'}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'payroll'}
              onClick={() => { sounds.playClick(); setActiveTab('payroll'); }}
              className={`flex-1 sm:flex-none whitespace-nowrap px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 flex items-center justify-center gap-1.5 ${
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
            className="w-full sm:w-auto whitespace-nowrap"
            onClick={() => { resetForm(); setIsModalOpen(true); }}
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
              placeholder={searchLabel}
              aria-label={searchLabel}
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
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{isRtl ? 'عدد الموظفين' : 'Employees'}</span>
              </div>
              <span className="text-xl font-black text-gray-900 dark:text-white">{employees.length}</span>
            </div>
            <div className="lg:col-span-3 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-emerald-600 dark:text-emerald-400">
                  <DollarSign size={20} />
                </div>
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400">{isRtl ? 'إجمالي الرواتب الأساسية' : 'Total basic salaries'}</span>
              </div>
              <span className="text-lg font-mono font-black text-emerald-600 dark:text-emerald-400 text-end">{(() => {
                const totals: Record<string, number> = {};
                employees.forEach((emp) => {
                  const code = salaryCurrencyOf(emp);
                  totals[code] = (totals[code] || 0) + (Number(emp.salary) || 0);
                });
                const parts = Object.entries(totals).filter(([, amount]) => amount !== 0).map(([code, amount]) => money(amount, code));
                return parts.length ? parts.join('  •  ') : money(0, systemCurrency);
              })()}</span>
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
                onDelete={handleDeleteEmployee}
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
          className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden"
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
                  <th className="py-4 px-6 text-center">{isRtl ? 'تاريخ الدفع' : 'Payment date'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'حالة الصرف' : 'Status'}</th>
                  <th className="py-4 px-6 text-center">{isRtl ? 'حذف' : 'Delete'}</th>
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
                        +{money(record.allowances, record.currency)}
                      </td>
                      <td className="py-4 px-6 text-center text-rose-500 dark:text-rose-400 font-mono font-bold">
                        -{money(record.deductions, record.currency)}
                      </td>
                      <td className="py-4 px-6 text-center text-indigo-600 dark:text-indigo-400 font-mono font-black text-md">
                        {money(record.netSalary, record.currency)}
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
                            {isRtl ? 'صرف الراتب' : 'Pay salary'}
                          </button>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeletePayroll(record.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all cursor-pointer"
                         aria-label={isRtl ? 'حذف' : 'Delete'}>
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
          <div className={SHEET_OVERLAY}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEmployeeForm}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="employee-form-title"
              onKeyDown={(e) => { if (e.key === 'Escape') closeEmployeeForm(); }}
              className={SHEET_PANEL}
            >
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                <div className={SHEET_HEADER}>
                  <div className="p-2.5 bg-indigo-600 rounded-xl text-white">
                    <UserPlus size={20} />
                  </div>
                  <h3 id="employee-form-title" className="flex-1 text-lg font-bold text-gray-900 dark:text-white">
                    {editingEmployee ? t.editEmployee : t.addEmployee}
                  </h3>
                  <button
                    type="button"
                    onClick={closeEmployeeForm}
                    aria-label={isRtl ? 'إغلاق' : 'Close'}
                    className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className={SHEET_BODY}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="emp-name" className={FIELD_LABEL}>{t.employeeName}</label>
                      <input
                        id="emp-name"
                        required
                        type="text"
                        autoComplete="off"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className={FIELD_INPUT}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="emp-role" className={FIELD_LABEL}>{t.role}</label>
                      <input
                        id="emp-role"
                        required
                        type="text"
                        autoComplete="off"
                        value={formData.role}
                        onChange={(e) => setFormData({...formData, role: e.target.value})}
                        className={FIELD_INPUT}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="emp-contact" className={FIELD_LABEL}>{t.contact}</label>
                    <input
                      id="emp-contact"
                      type="text"
                      dir="ltr"
                      autoComplete="off"
                      placeholder={isRtl ? 'رقم الهاتف أو البريد' : 'Phone or email'}
                      value={formData.contact}
                      onChange={(e) => setFormData({...formData, contact: e.target.value})}
                      className={`${FIELD_INPUT} ${isRtl ? 'text-right' : ''}`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="emp-salary" className={FIELD_LABEL}>{t.salary}</label>
                    <div className="flex gap-2">
                      <input
                        id="emp-salary"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        placeholder="0"
                        value={formData.salary || ''}
                        onChange={(e) => setFormData({...formData, salary: Number(e.target.value)})}
                        className={`${FIELD_INPUT} flex-1 min-w-0 font-mono`}
                      />
                      <CurrencySelect
                        value={isPosCurrency(formData.currency) ? formData.currency : systemCurrency}
                        onChange={(code) => setFormData({ ...formData, currency: code })}
                        isRtl={isRtl}
                        disabled={salaryCurrencyLocked}
                        aria-label={isRtl ? 'عملة الراتب' : 'Salary currency'}
                        className="w-44 shrink-0"
                      />
                    </div>
                    <p className="text-xs text-gray-400">
                      {salaryCurrencyLocked
                        ? (isRtl ? 'لا يمكن تغيير عملة الراتب بعد وجود مسير لهذا الموظف.' : 'Salary currency cannot change after a payroll record exists.')
                        : (isRtl
                          ? 'إذا صُرف الراتب بعملة أخرى يُحوَّل بسعر الصرف وقت الصرف.'
                          : 'Paying in another currency converts the salary at the rate on the day of payment.')}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <span className={FIELD_LABEL}>{t.employeeStatus}</span>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t.employeeStatus}>
                      {['active', 'on-leave', 'terminated'].map(status => (
                        <button
                          key={status}
                          type="button"
                          aria-pressed={formData.status === status}
                          onClick={() => setFormData({...formData, status: status as any})}
                          className={`py-2.5 px-1 rounded-xl border-2 font-bold text-sm transition-all ${
                            formData.status === status
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                              : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:border-gray-200'
                          }`}
                        >
                          {statusLabel(t, status)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={SHEET_FOOTER}>
                  <TactileButton type="button" variant="secondary" className="flex-1 px-3 whitespace-nowrap" onClick={closeEmployeeForm}>
                    {t.cancel}
                  </TactileButton>
                  <TactileButton type="submit" className="flex-[2] px-3 whitespace-nowrap">
                    {t.saveEmployee}
                  </TactileButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Salary payment dialog */}
      <AnimatePresence>
        {selectedPayEmployee && (
          <div className={SHEET_OVERLAY}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (!isPaying) setSelectedPayEmployee(null); }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="payroll-form-title"
              onKeyDown={(e) => { if (e.key === 'Escape' && !isPaying) setSelectedPayEmployee(null); }}
              className={SHEET_PANEL}
            >
              <div className={SHEET_HEADER}>
                <div className="p-2.5 bg-indigo-600 rounded-xl text-white">
                  <DollarSign size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="payroll-form-title" className="text-lg font-bold text-gray-900 dark:text-white">
                    {isRtl ? 'صرف راتب' : 'Pay salary'}
                  </h3>
                  <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 truncate">
                    {selectedPayEmployee.name} · {selectedPayEmployee.role}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => setSelectedPayEmployee(null)}
                  aria-label={isRtl ? 'إغلاق' : 'Close'}
                  className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className={SHEET_BODY}>
                <div className="space-y-1.5">
                  <label htmlFor="pay-month" className={FIELD_LABEL}>
                    {isRtl ? 'فترة الراتب (الشهر والسنة)' : 'Salary period (month/year)'}
                  </label>
                  <input
                    id="pay-month"
                    type="month"
                    value={payrollMonthYear}
                    onChange={(e) => setPayrollMonthYear(e.target.value)}
                    className={`${FIELD_INPUT} font-bold`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pay-currency" className={FIELD_LABEL}>
                    {isRtl ? 'عملة صرف الراتب' : 'Payroll currency'}
                  </label>
                  <CurrencySelect
                    id="pay-currency"
                    value={payrollCurrency}
                    onChange={setPayrollCurrency}
                    isRtl={isRtl}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="pay-allowances" className={`${FIELD_LABEL} flex items-center gap-1.5`}>
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      {isRtl ? 'علاوات وإضافات' : 'Allowances / additions'}
                    </label>
                    <input
                      id="pay-allowances"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="0"
                      value={payrollAllowances || ''}
                      onChange={(e) => setPayrollAllowances(Math.max(0, Number(e.target.value) || 0))}
                      className={`${FIELD_INPUT} font-mono font-bold`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="pay-deductions" className={`${FIELD_LABEL} flex items-center gap-1.5`}>
                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                      {isRtl ? 'استقطاعات وخصومات' : 'Deductions'}
                    </label>
                    <input
                      id="pay-deductions"
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="0"
                      value={payrollDeductions || ''}
                      onChange={(e) => setPayrollDeductions(Math.max(0, Number(e.target.value) || 0))}
                      className={`${FIELD_INPUT} font-mono font-bold`}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className={FIELD_LABEL}>
                    {isRtl ? 'حالة الصرف' : 'Payment status'}
                  </span>
                  <div className="grid grid-cols-2 gap-2" role="group">
                    <button
                      type="button"
                      aria-pressed={payrollStatus === 'paid'}
                      onClick={() => setPayrollStatus('paid')}
                      className={`py-2.5 rounded-xl text-sm font-bold transition-all border ${
                        payrollStatus === 'paid'
                          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                          : 'border-gray-100 dark:border-gray-800 bg-white/30 dark:bg-gray-950/30 text-gray-400'
                      }`}
                    >
                      {isRtl ? 'صرف فوري وخصم من الخزنة' : 'Paid Immediately'}
                    </button>
                    <button
                      type="button"
                      aria-pressed={payrollStatus === 'pending'}
                      onClick={() => setPayrollStatus('pending')}
                      className={`py-2.5 rounded-xl text-sm font-bold transition-all border ${
                        payrollStatus === 'pending'
                          ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400'
                          : 'border-gray-100 dark:border-gray-800 bg-white/30 dark:bg-gray-950/30 text-gray-400'
                      }`}
                    >
                      {isRtl ? 'معلّق (غير مدفوع)' : 'Pending (unpaid)'}
                    </button>
                  </div>
                </div>

                {/* Detailed Invoice Breakdown */}
                <div className="p-4 bg-gray-50 dark:bg-gray-950 border border-gray-100/50 dark:border-gray-800/80 rounded-2xl space-y-2 mt-4">
                  <div className="flex justify-between text-xs font-bold text-gray-500 dark:text-gray-400">
                    <span>{isRtl ? 'الراتب الأساسي' : 'Basic Salary'}</span>
                    <span className="font-mono">
                      {formatMoney(baseSalaryIn(selectedPayEmployee, payrollCurrency), payrollCurrency, isRtl ? 'ar' : 'en-US')}
                    </span>
                  </div>
                  {payRateMissing ? (
                    <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                      {isRtl
                        ? `لا يوجد سعر صرف حديث من ${salaryCurrencyOf(selectedPayEmployee)} إلى ${payrollCurrency}. اتصل بالإنترنت لتحديث الأسعار، أو أدخل أسعارك يدوياً من الإعدادات، أو اصرف الراتب بعملته.`
                        : `No recent ${salaryCurrencyOf(selectedPayEmployee)} → ${payrollCurrency} rate. Go online to refresh rates, set manual rates in Settings, or pay in the salary currency.`}
                    </p>
                  ) : salaryCurrencyOf(selectedPayEmployee) !== payrollCurrency && (
                    <p className="text-[11px] text-slate-400">
                      {isRtl
                        ? `محوّل من ${money(selectedPayEmployee.salary, salaryCurrencyOf(selectedPayEmployee))} بسعر الصرف الحالي.`
                        : `Converted from ${money(selectedPayEmployee.salary, salaryCurrencyOf(selectedPayEmployee))} at the current rate.`}
                    </p>
                  )}
                  <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>{isRtl ? 'علاوات وإضافات (+)' : 'Allowances (+)'}</span>
                    <span className="font-mono">+{money(payrollAllowances, payrollCurrency)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-rose-500 dark:text-rose-400">
                    <span>{isRtl ? 'استقطاعات وخصومات (-)' : 'Deductions (-)'}</span>
                    <span className="font-mono">-{money(payrollDeductions, payrollCurrency)}</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-800/80 pt-2 flex justify-between items-center text-sm font-black text-indigo-600 dark:text-indigo-400">
                    <span>{isRtl ? 'صافي المبلغ النهائي' : 'Estimated Net Pay'}</span>
                    <span className="text-lg font-mono">
                      {formatMoney(baseSalaryIn(selectedPayEmployee, payrollCurrency) + Number(payrollAllowances) - Number(payrollDeductions), payrollCurrency, isRtl ? 'ar' : 'en-US')}
                    </span>
                  </div>
                </div>
              </div>

              <div className={SHEET_FOOTER}>
                <button
                  type="button"
                  disabled={isPaying}
                  onClick={() => { setSelectedPayEmployee(null); sounds.playClick(); }}
                  className="flex-1 py-3 px-3 whitespace-nowrap bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-2xl font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={isPaying || payRateMissing}
                  onClick={handleConfirmPayment}
                  className="flex-[2] py-3 px-3 whitespace-nowrap bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPaying
                    ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
                    : payrollStatus === 'paid'
                      ? (isRtl ? 'صرف الراتب من الخزنة' : 'Pay from vault')
                      : (isRtl ? 'حفظ كمعلّق' : 'Save as pending')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
