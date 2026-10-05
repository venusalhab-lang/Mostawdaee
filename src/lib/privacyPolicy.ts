export interface PolicySection {
  title: string;
  body: string[];
}

export interface PolicyDoc {
  title: string;
  updated: string;
  sections: PolicySection[];
}

export const SUPPORT_EMAIL = 'venusalhab@gmail.com';
export const PRIVACY_PATH = '/privacy';
export const ACCOUNT_DELETION_PATH = '/delete-account';

/**
 * The privacy policy shown in the app and at /privacy. Every statement here must match what the code does:
 * staff tools, the assistant context, account deletion and the used-trial hash.
 */
export function privacyPolicy(ar: boolean): PolicyDoc {
  if (ar) {
    return {
      title: 'سياسة الخصوصية لتطبيق مستودعي',
      updated: 'آخر تحديث: ٥ أكتوبر ٢٠٢٦',
      sections: [
        {
          title: '١. ما نجمعه',
          body: [
            'بيانات الحساب: الاسم والبريد الإلكتروني من حساب Google أو من التسجيل بالبريد.',
            'بيانات متجرك التي تُدخلها أنت وفريقك: الأصناف والمستودعات والفواتير والعملاء وديونهم والموظفين والرواتب والخزنة والشيكات والجرد وسجل النشاط.',
            'الاشتراك: حالته وتاريخ انتهائه، ورمز الشراء من Google Play. لا نستلم بيانات بطاقتك.',
            'عدد أسئلة المساعد الذكي واستهلاكه اليومي، لتطبيق الحد اليومي.',
            'الكاميرا تُستخدم فقط لمسح الباركود عند طلبك، ولا تُحفظ الصور.',
          ],
        },
        {
          title: '٢. كيف نستخدمها',
          body: [
            'لتشغيل متجرك ومزامنته بين أجهزتك وأعضاء فريقك، والتحقق من الاشتراك، والرد على طلبات الدعم.',
            'لا نبيع بياناتك ولا نستخدمها للإعلانات.',
          ],
        },
        {
          title: '٣. من يرى بيانات متجرك',
          body: [
            'أنت، وأعضاء فريقك حسب الدور الذي تمنحه لكل منهم (مدير أو كاشير).',
            'فريق مستودعي (الدعم والعمليات) يرى في أدواته: البريد واسم المتجر وحالة الاشتراك ورسائل الدعم وعدد أسئلة المساعد. لا تعرض أدوات الفريق دفاتر متجرك (الأصناف والفواتير والعملاء والرواتب والخزنة)، ولا نطّلع عليها إلا بطلب منك لحل مشكلة.',
            'كل تغيير يجريه الفريق على اشتراكك يُسجَّل في سجل تدقيق لا يمكن تعديله أو حذفه.',
          ],
        },
        {
          title: '٤. مزودو الخدمة',
          body: [
            'مزود استضافة سحابي متخصص: لقاعدة البيانات وتسجيل الدخول.',
            'Google: تسجيل الدخول، والدفع عبر Google Play، وخدمة Google Drive فقط إذا فعّلت النسخ الاحتياطي إليها، ويُحفظ الملف في حسابك أنت.',
            'Google Gemini: عند استخدام المساعد الذكي يُرسل سؤالك مع ملخص بيانات المتجر اللازم للإجابة (أسماء الأصناف وكمياتها وأسعارها، وأسماء العملاء وأرصدتهم، وأرصدة الخزنة، وملخص المبيعات). لا يُرسل شيء إن لم تستخدم المساعد.',
            'أسعار الصرف تُجلب من مزود عام دون إرسال أي بيانات شخصية.',
          ],
        },
        {
          title: '٥. الأمان',
          body: [
            'الاتصال مشفّر، وكل متجر معزول عن غيره بصلاحيات تفرضها قاعدة البيانات نفسها، والعمليات المالية الحساسة تُتحقق على الخادم.',
          ],
        },
        {
          title: '٦. الاحتفاظ وحذف الحساب',
          body: [
            'تبقى بياناتك ما دام حسابك قائماً. يمكنك حذف حسابك في أي وقت من الإعدادات ← الحساب.',
            'حذف حساب المالك يحذف المتجر وكل دفاتره نهائياً ويُخرج أعضاء فريقه. حذف حساب العضو يُخرجه من المتجر فقط، وتبقى السجلات التي أدخلها ملكاً للمتجر.',
            'بعد الحذف نحتفظ فقط ببصمة مشفّرة غير قابلة للعكس لبريدك مع تاريخ بدء الفترة التجريبية لمنع تكرارها، وبسجل تدقيق إجراءات الفريق.',
            'قد تبقى نسخة في النسخ الاحتياطية التقنية لمزود الاستضافة حتى تنقضي دورتها. النسخ التي حفظتها بنفسك على جهازك أو في Google Drive تبقى تحت تصرفك.',
          ],
        },
        {
          title: '٧. الاشتراك',
          body: [
            'إلغاء اشتراك Google Play يتم من Google Play نفسه. حذف الحساب لا يلغي الاشتراك تلقائياً.',
          ],
        },
        {
          title: '٨. التواصل',
          body: [`راسلنا على ${SUPPORT_EMAIL} أو من مركز الدعم داخل التطبيق.`],
        },
      ],
    };
  }
  return {
    title: 'Mostawdaee Privacy Policy',
    updated: 'Last updated: October 5, 2026',
    sections: [
      {
        title: '1. What we collect',
        body: [
          'Account data: your name and email address from your Google account or email sign-up.',
          'The store data you and your team enter: products, warehouses, invoices, customers and their debts, employees and payroll, the vault, cheques, stocktakes and the activity log.',
          'Subscription: its status and end date, and the Google Play purchase token. We never receive your card details.',
          'How many assistant questions your store asks each day, to apply the daily limit.',
          'The camera is used only to scan barcodes when you ask; no pictures are kept.',
        ],
      },
      {
        title: '2. How we use it',
        body: [
          'To run your store and keep it in sync across your devices and team, check your subscription, and answer support requests.',
          'We do not sell your data or use it for advertising.',
        ],
      },
      {
        title: '3. Who sees your store data',
        body: [
          'You, and your team members according to the role you give each of them (manager or cashier).',
          'The Mostawdaee team (support and operations) sees in its tools: your email, store name, subscription status, support messages and the number of assistant questions. Team tools do not show your books (products, invoices, customers, payroll, vault), and we only look at them if you ask us to fix a problem.',
          'Every change the team makes to your subscription is recorded in an audit log that cannot be edited or deleted.',
        ],
      },
      {
        title: '4. Service providers',
        body: [
          'A specialised cloud hosting provider: database and sign-in.',
          'Google: sign-in, payment through Google Play, and Google Drive only if you turn on Drive backups; the file is saved in your own account.',
          'Google Gemini: when you use the assistant, your question is sent with the store summary needed to answer it (product names, quantities and prices, customer names and balances, vault balances and a sales summary). Nothing is sent if you do not use the assistant.',
          'Exchange rates come from a public provider; no personal data is sent.',
        ],
      },
      {
        title: '5. Security',
        body: [
          'Connections are encrypted, each store is isolated by permissions enforced in the database itself, and sensitive money operations are checked on the server.',
        ],
      },
      {
        title: '6. Retention and account deletion',
        body: [
          'Your data is kept while your account exists. You can delete your account at any time from Settings → Account.',
          "Deleting an owner account permanently deletes the store and all its books and removes its team. Deleting a member account only removes that member; the records they entered stay with the store.",
          'After deletion we keep only an irreversible hash of your email with your trial start date, so the free trial is not repeated, and the audit log of team actions.',
          "A copy may remain in the hosting provider's technical backups until they expire. Backups you saved yourself on your device or in Google Drive stay in your control.",
        ],
      },
      {
        title: '7. Subscription',
        body: ['A Google Play subscription is cancelled in Google Play. Deleting your account does not cancel it automatically.'],
      },
      {
        title: '8. Contact',
        body: [`Email ${SUPPORT_EMAIL} or use the support center in the app.`],
      },
    ],
  };
}

/** The public account deletion page Google Play links to. */
export function accountDeletionInfo(ar: boolean): PolicyDoc {
  if (ar) {
    return {
      title: 'حذف حسابك في مستودعي',
      updated: 'آخر تحديث: ٥ أكتوبر ٢٠٢٦',
      sections: [
        {
          title: 'من داخل التطبيق',
          body: [
            'افتح الإعدادات ← الحساب ← حذف الحساب، ثم اكتب بريدك الإلكتروني للتأكيد. يتم الحذف فوراً.',
            'إن كان لديك اشتراك في Google Play فألغِه أولاً من Google Play ← الاشتراكات، لأن حذف الحساب لا يلغيه.',
            'ننصح بتنزيل نسخة احتياطية من الإعدادات ← النظام قبل الحذف.',
          ],
        },
        {
          title: 'ما الذي يُحذف',
          body: [
            'حساب المالك: الحساب والمتجر وكل دفاتره (الأصناف والفواتير والعملاء والموظفين والرواتب والخزنة والشيكات والجرد) وطلبات الدعم، ويُخرج أعضاء الفريق من المتجر.',
            'حساب العضو (مدير أو كاشير): الحساب وعضويته وطلبات الدعم التي أرسلها. السجلات التي أدخلها في المتجر تبقى ملكاً لصاحب المتجر.',
          ],
        },
        {
          title: 'ما الذي نحتفظ به',
          body: [
            'بصمة مشفّرة غير قابلة للعكس للبريد مع تاريخ بدء الفترة التجريبية، لمنع تكرار الفترة المجانية.',
            'سجل تدقيق إجراءات فريق مستودعي على الاشتراكات.',
            'قد تبقى نسخة في النسخ الاحتياطية التقنية لمزود الاستضافة حتى تنقضي دورتها.',
          ],
        },
        {
          title: 'إن لم تستطع فتح التطبيق',
          body: [`راسلنا على ${SUPPORT_EMAIL} من البريد المسجّل في حسابك وسنحذفه خلال ٣٠ يوماً.`],
        },
      ],
    };
  }
  return {
    title: 'Delete your Mostawdaee account',
    updated: 'Last updated: October 5, 2026',
    sections: [
      {
        title: 'In the app',
        body: [
          'Open Settings → Account → Delete account and type your email to confirm. Deletion is immediate.',
          'If you have a Google Play subscription, cancel it first in Google Play → Subscriptions; deleting the account does not cancel it.',
          'We recommend downloading a backup from Settings → System first.',
        ],
      },
      {
        title: 'What is deleted',
        body: [
          'Owner account: the account, the store and all its books (products, invoices, customers, employees, payroll, vault, cheques, stocktakes) and support requests; team members are removed from the store.',
          'Member account (manager or cashier): the account, the membership and the support requests it sent. Records it entered in the store stay with the store owner.',
        ],
      },
      {
        title: 'What we keep',
        body: [
          'An irreversible hash of the email with the trial start date, so the free trial is not repeated.',
          "The audit log of the Mostawdaee team's actions on subscriptions.",
          "A copy may remain in the hosting provider's technical backups until they expire.",
        ],
      },
      {
        title: 'If you cannot open the app',
        body: [`Email ${SUPPORT_EMAIL} from the address on your account and we will delete it within 30 days.`],
      },
    ],
  };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A self-contained page for the public /privacy and /delete-account links. */
export function renderPolicyHtml(doc: PolicyDoc, ar: boolean, otherLanguageHref: string): string {
  const sections = doc.sections.map((s) => `
    <section>
      <h2>${escapeHtml(s.title)}</h2>
      <ul>${s.body.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </section>`).join('');
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 20px; color: #1f2937; line-height: 1.7; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 28px 0 8px; }
  ul { padding-inline-start: 20px; margin: 0; }
  li { margin: 6px 0; }
  .muted { color: #6b7280; font-size: .9rem; }
  a { color: #4f46e5; }
</style>
</head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="muted">${escapeHtml(doc.updated)} · <a href="${escapeHtml(otherLanguageHref)}">${ar ? 'English' : 'العربية'}</a></p>
  ${sections}
</body>
</html>`;
}
