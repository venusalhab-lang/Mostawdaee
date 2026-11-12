/** In-app task guide shown under Settings → User guide. */

export type GuideScreen =
  | 'pos'
  | 'customers'
  | 'inventory'
  | 'inventory-audit'
  | 'warehouses'
  | 'purchases-expenses'
  | 'vault'
  | 'invoices'
  | 'profits-dashboard'
  | 'employees'
  | 'cheques';

export type GuideSettingsSection =
  | 'team'
  | 'support'
  | 'subscription'
  | 'printing'
  | 'account'
  | 'system';

export interface GuideTopic {
  id: string;
  /** Group heading key for the index. */
  group: 'sales' | 'stock' | 'money' | 'team' | 'more';
  title: { ar: string; en: string };
  summary: { ar: string; en: string };
  steps: { ar: string; en: string }[];
  warning?: { ar: string; en: string };
  openScreen?: GuideScreen;
  openSettings?: GuideSettingsSection;
}

export const GUIDE_GROUPS: { id: GuideTopic['group']; ar: string; en: string }[] = [
  { id: 'sales', ar: 'البيع والزبائن', en: 'Sales & customers' },
  { id: 'stock', ar: 'المخزون والجرد', en: 'Stock & counting' },
  { id: 'money', ar: 'الخزنة والمال', en: 'Vault & money' },
  { id: 'team', ar: 'الفريق والصلاحيات', en: 'Team & access' },
  { id: 'more', ar: 'المزيد', en: 'More' },
];

export const USER_GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'cash-sale',
    group: 'sales',
    title: { ar: 'بيع نقدي من نقطة البيع', en: 'Cash sale at the POS' },
    summary: {
      ar: 'أضف الأصناف بالمسح أو البحث، اختر نقدي، ثم أتمم وطباعة.',
      en: 'Add items by scan or search, choose Cash, then complete and print.',
    },
    steps: [
      { ar: 'افتح نقطة البيع وأضف الأصناف بالباركود أو من شبكة المنتجات.', en: 'Open the POS and add items by barcode or from the product grid.' },
      { ar: 'تأكد أن طريقة الدفع «نقدي».', en: 'Make sure payment method is Cash.' },
      { ar: 'اترك المبلغ المستلم فارغًا للدفع الكامل، أو أدخل ما استلمته لحساب الباقي.', en: 'Leave amount received empty for full payment, or enter what you took to calculate change.' },
      { ar: 'اضغط «إتمام وطباعة». يُخصم المخزون ويدخل النقد الخزنة عند تفعيل ذلك.', en: 'Tap Pay & Print. Stock is reduced and cash enters the vault when that path is enabled.' },
    ],
    openScreen: 'pos',
  },
  {
    id: 'credit-sale',
    group: 'sales',
    title: { ar: 'بيع آجل أو نقد + آجل', en: 'Credit sale or cash + credit' },
    summary: {
      ar: 'الدين يظهر على بطاقة الزبون فقط عند البيع الآجل (أو دفع أقل من الإجمالي مع اختيار زبون).',
      en: 'Debt appears on the customer card only for credit sales (or underpaying cash with a customer selected).',
    },
    steps: [
      { ar: 'من بطاقة الزبون اضغط «بيع أصناف لهذا الزبون»، أو اختر الزبون داخل نقطة البيع.', en: 'From the customer card tap Sell items, or pick the customer inside the POS.' },
      { ar: 'اختر طريقة الدفع «آجل» لوضع الفاتورة كلها على الحساب.', en: 'Choose Credit to put the whole invoice on account.' },
      { ar: 'للنقد + آجل: اختر نقدي، أدخل مبلغًا أقل من الإجمالي مع وجود زبون محدد.', en: 'For cash + credit: choose Cash, enter less than the total with a customer selected.' },
      { ar: 'بعد الإتمام يظهر المبلغ في «إجمالي الدين الفعلي» على بطاقة الزبون.', en: 'After checkout the amount shows as Outstanding Balance on the customer card.' },
    ],
    warning: {
      ar: 'حقل المبلغ المستلم الفارغ مع «نقدي» = بيع نقد كامل، حتى لو كان الزبون مختارًا. للدين اختر «آجل» أو أدخل 0 / مبلغًا أقل.',
      en: 'An empty received-amount field with Cash means a full cash sale, even if a customer is selected. For debt choose Credit, or type 0 / a lower amount.',
    },
    openScreen: 'pos',
  },
  {
    id: 'pay-debt',
    group: 'sales',
    title: { ar: 'سداد دين الزبون (جزئي أو كلي)', en: 'Collect customer debt (partial or full)' },
    summary: {
      ar: 'من بطاقة الزبون سجّل دفعة بأي مبلغ لا يتجاوز الدين الحالي.',
      en: 'From the customer card record a payment of any amount up to the current debt.',
    },
    steps: [
      { ar: 'افتح العملاء والديون واختر بطاقة الزبون.', en: 'Open Customers & debts and pick the customer card.' },
      { ar: 'اضغط «سداد دفعة» وأدخل المبلغ (جزء أو كامل الرصيد).', en: 'Tap Receive Payment and enter the amount (part or all of the balance).' },
      { ar: 'راجع معاينة المتبقي والفواتير التي تُغطّى (الأقدم أولًا) ثم طبّق.', en: 'Review the remaining-balance preview and which invoices are covered (oldest first), then apply.' },
      { ar: 'فعّل «تسجيل في الخزنة» إذا استلمت نقدًا فعليًا.', en: 'Enable Record in the vault if you actually received cash.' },
    ],
    openScreen: 'customers',
  },
  {
    id: 'statement',
    group: 'sales',
    title: { ar: 'كشف الحساب والواتساب', en: 'Statement and WhatsApp' },
    summary: {
      ar: 'اعرض الحركات والأصناف لفترة معيّنة، ثم اطبع أو أرسل عبر واتساب.',
      en: 'Show movements and items for a period, then print or send via WhatsApp.',
    },
    steps: [
      { ar: 'من بطاقة الزبون افتح «كشف الحساب والأصناف».', en: 'From the customer card open Statement & items.' },
      { ar: 'اختر الفترة (هذا الشهر / الكل / من–إلى) وتصفّح تبويب الحركات أو الأصناف.', en: 'Pick the period (this month / all / from–to) and browse Movements or Items.' },
      { ar: '«إرسال كشف الفترة» يجهّز رسالة واتساب لنفس الفترة المعروضة.', en: 'Send period statement prepares a WhatsApp message for the same period.' },
    ],
    openScreen: 'customers',
  },
  {
    id: 'stock',
    group: 'stock',
    title: { ar: 'المخزون والمستودعات', en: 'Stock and warehouses' },
    summary: {
      ar: 'كل صنف مرتبط بمستودع؛ البيع يخصم من المخزن المختار في نقطة البيع.',
      en: 'Each product belongs to a warehouse; sales deduct from the warehouse chosen at the POS.',
    },
    steps: [
      { ar: 'أضف المستودعات من شاشة المستودعات إن لزم.', en: 'Add warehouses from the Warehouses screen if needed.' },
      { ar: 'في المخزون أنشئ أو عدّل الأصناف والكميات والتكاليف.', en: 'In Inventory create or edit products, quantities, and costs.' },
      { ar: 'عند البيع اختر «البيع من» المستودع الصحيح حتى لا يُخصم من صف آخر.', en: 'When selling, choose Sell from the correct warehouse so another row is not reduced.' },
    ],
    openScreen: 'inventory',
  },
  {
    id: 'stocktake',
    group: 'stock',
    title: { ar: 'الجرد والتسوية', en: 'Stocktaking' },
    summary: {
      ar: 'عدّ الكميات الفعلية، راجع الفروقات، ثم اعتمد لتثبيت المخزون.',
      en: 'Count actual quantities, review variances, then apply to set stock.',
    },
    steps: [
      { ar: 'افتح الجرد والتسوية وأضف الأصناف بالمسح أو البحث.', en: 'Open Stocktaking and add products by scan or search.' },
      { ar: 'أدخل العدد الفعلي لكل سطر واحفظ مسودة إن توقفت.', en: 'Enter the counted qty on each line and save a draft if you pause.' },
      { ar: 'عند الاعتماد تُحدَّث كميات المخزون حسب الفروقات. إن تغيّر المسجّل أثناء الجرد استخدم «تحديث المسجّل».', en: 'On apply, stock quantities update from the variances. If the book changed during the count, use Refresh book.' },
    ],
    warning: {
      ar: 'لا تعدّل الكمية يدويًا من المخزون لتثبيت جرد؛ استخدم شاشة الجرد حتى يبقى السجل واضحًا.',
      en: 'Do not fix a physical count by editing quantity in Inventory; use Stocktaking so the record stays clear.',
    },
    openScreen: 'inventory-audit',
  },
  {
    id: 'purchases',
    group: 'stock',
    title: { ar: 'المشتريات والمصروفات', en: 'Purchases and expenses' },
    summary: {
      ar: 'سجّل التوريد أو المصروف من الشاشة المخصصة، واربط المورد عند الشراء الآجل.',
      en: 'Record supply or expenses on the dedicated screen, and link a supplier for credit purchases.',
    },
    steps: [
      { ar: 'افتح المشتريات والمصروفات واختر نوع الحركة.', en: 'Open Purchases & expenses and choose the movement type.' },
      { ar: 'للشراء الآجل اختر موردًا مسجّلًا حتى يُحدَّث رصيده.', en: 'For a credit purchase pick a registered supplier so their balance updates.' },
      { ar: 'يمكنك أيضًا التوريد السريع من وضع التوريد في نقطة البيع.', en: 'You can also receive stock quickly via Purchase mode on the POS.' },
    ],
    openScreen: 'purchases-expenses',
  },
  {
    id: 'vault',
    group: 'money',
    title: { ar: 'الخزنة والعملات', en: 'Vault and currencies' },
    summary: {
      ar: 'كل عملة رصيد مستقل؛ لا تُخلط المبالغ دون تحويل.',
      en: 'Each currency is its own balance; amounts are never mixed without conversion.',
    },
    steps: [
      { ar: 'افتح الخزنة لعرض الأرصدة والحركات.', en: 'Open the Vault to see balances and movements.' },
      { ar: 'الإيداع والسحب يُسجَّلان بتاريخ وسبب عند الحاجة.', en: 'Deposits and withdrawals are recorded with date and a reason when needed.' },
      { ar: 'تسوية الرصيد بعد جرد نقدي تتطلب سببًا واضحًا وتُحفظ في السجل.', en: 'Recalibrating after a cash count requires a clear reason and is kept in the audit trail.' },
    ],
    openScreen: 'vault',
  },
  {
    id: 'shift',
    group: 'money',
    title: { ar: 'الوردية وعدّ الدرج', en: 'Shift and drawer count' },
    summary: {
      ar: 'إن فُعّل اشتراط الوردية، افتح العدّ قبل البيع النقدي.',
      en: 'If open-shift is required, open the drawer count before cash sales.',
    },
    steps: [
      { ar: 'من نقطة البيع أو الإعدادات فعّل «يتطلب وردية مفتوحة» إن أردت الالتزام بذلك.', en: 'From the POS or Settings enable Require open shift if you want that rule.' },
      { ar: 'افتح لوحة الوردية، سجّل نقد البداية، ثم بع.', en: 'Open the shift panel, record opening cash, then sell.' },
      { ar: 'عند الإغلاق قارن المتوقع بالمعدود لكل عملة.', en: 'At close, compare expected vs counted cash per currency.' },
    ],
    openScreen: 'pos',
  },
  {
    id: 'team',
    group: 'team',
    title: { ar: 'دعوة الفريق والصلاحيات', en: 'Invite the team and set roles' },
    summary: {
      ar: 'صاحب المتجر يدعو الموظفين ويحدد دور كل عضو.',
      en: 'The store owner invites staff and sets each member’s role.',
    },
    steps: [
      { ar: 'من الإعدادات → الفريق أرسل دعوة بالبريد.', en: 'From Settings → Team send an invite by email.' },
      { ar: 'اختر الدور (مثل كاشير أو مدير) حسب ما يحتاجه العمل.', en: 'Pick the role (e.g. cashier or manager) for what the job needs.' },
      { ar: 'الكاشير لا يصل عادةً للنسخ الاحتياطي أو إعدادات الاشتراك.', en: 'A cashier usually cannot access backup or subscription settings.' },
    ],
    openSettings: 'team',
  },
  {
    id: 'invoices',
    group: 'more',
    title: { ar: 'الفواتير والمرتجعات', en: 'Invoices and returns' },
    summary: {
      ar: 'راجع الفواتير المحفوظة ونفّذ المرتجع من الفاتورة الأصلية عند الحاجة.',
      en: 'Review saved invoices and process returns from the original invoice when needed.',
    },
    steps: [
      { ar: 'افتح شاشة الفواتير للبحث والطباعة.', en: 'Open Invoices to search and print.' },
      { ar: 'المرتجع يعكس المخزون والدين معًا عند ربطه بالفاتورة الصحيحة.', en: 'A return reverses stock and debt together when linked to the correct invoice.' },
    ],
    openScreen: 'invoices',
  },
  {
    id: 'backup',
    group: 'more',
    title: { ar: 'نسخة احتياطية محلية', en: 'Local backup' },
    summary: {
      ar: 'صدّر بيانات المتجر من الإعدادات واستعدها بحذر.',
      en: 'Export store data from Settings and restore carefully.',
    },
    steps: [
      { ar: 'الإعدادات → إدارة النظام → تصدير النسخة (لصاحب المتجر).', en: 'Settings → System → export backup (store owner).' },
      { ar: 'احفظ الملف في مكان آمن خارج الجهاز.', en: 'Keep the file somewhere safe off the device.' },
      { ar: 'الاستعادة تستبدل أو تدمج حسب الخيار؛ اقرأ التحذير قبل التأكيد.', en: 'Restore replaces or merges per the option; read the warning before confirming.' },
    ],
    openSettings: 'system',
  },
  {
    id: 'support',
    group: 'more',
    title: { ar: 'طلب دعم فني', en: 'Contact support' },
    summary: {
      ar: 'إذا تعثّرت بعد الدليل، راسل الفريق من الإعدادات مع تفاصيل المشكلة.',
      en: 'If you are still stuck after the guide, message the team from Settings with the details.',
    },
    steps: [
      { ar: 'الإعدادات → الدعم الفني → طلب جديد.', en: 'Settings → Support → New request.' },
      { ar: 'اكتب ما فعلتَه وما ظهر على الشاشة؛ الفريق لا يرى دفاترك تلقائيًا.', en: 'Describe what you did and what appeared on screen; the team cannot see your books automatically.' },
    ],
    openSettings: 'support',
  },
];

export function guideTopicsByGroup(group: GuideTopic['group']): GuideTopic[] {
  return USER_GUIDE_TOPICS.filter((t) => t.group === group);
}
