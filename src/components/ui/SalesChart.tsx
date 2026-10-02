import React from 'react';

interface SalesChartProps {
  language?: 'ar' | 'en';
}

export function SalesChart({ language = 'ar' }: SalesChartProps) {
  const isRtl = language === 'ar';
  
  // أيام الأسبوع كمثال لعرض البيانات
  const days = isRtl 
    ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // نسب افتراضية لارتفاع الأعمدة البيانية لتمثيل حركة المبيعات (₪) والمشتريات ($)
  const chartData = [
    { sales: 'h-[45%]', purchases: 'h-[30%]' },
    { sales: 'h-[60%]', purchases: 'h-[40%]' },
    { sales: 'h-[75%]', purchases: 'h-[50%]' },
    { sales: 'h-[50%]', purchases: 'h-[55%]' },
    { sales: 'h-[90%]', purchases: 'h-[35%]' }, // ذروة الأسبوع
    { sales: 'h-[20%]', purchases: 'h-[15%]' }, // يوم إغلاق أو حركة خفيفة
    { sales: 'h-[65%]', purchases: 'h-[42%]' },
  ];

  return (
    <div className="w-full h-full flex flex-col justify-between text-slate-900 dark:text-white select-none">
      {/* رأس المخطط: التحكم والفلترة السريعة */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4 text-xs font-arabic">
          {/* دليل الألوان */}
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-t from-emerald-500 to-teal-400"></span>
            <span className="text-slate-550 dark:text-slate-400 font-bold">
              {isRtl ? 'المبيعات (₪)' : 'Sales (₪)'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-t from-sky-500 to-indigo-400"></span>
            <span className="text-slate-550 dark:text-slate-400 font-bold">
              {isRtl ? 'المشتريات ($)' : 'Purchases ($)'}
            </span>
          </div>
        </div>

        {/* أزرار الفلترة السريعة بتأثير زجاجي مصغر */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-[11px] font-arabic">
          <button className="px-2.5 py-1 rounded-md bg-white dark:bg-white/10 text-slate-800 dark:text-white font-bold shadow-sm transition-all">
            {isRtl ? 'أسبوعي' : 'Weekly'}
          </button>
          <button className="px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all">
            {isRtl ? 'شهري' : 'Monthly'}
          </button>
        </div>
      </div>

      {/* منطقة الرسم البياني التفاعلية */}
      <div className="flex-1 flex items-end justify-between gap-4 px-2 pb-2 border-b border-slate-100 dark:border-white/5 relative group/chart min-h-[160px]">
        
        {/* خطوط شبكة الخلفية الأفقية الخفيفة لتعزيز الرؤية بدون التأثير على الأداء */}
        <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col justify-between pointer-events-none opacity-20 dark:opacity-25">
          <div className="w-full border-t border-slate-350 dark:border-slate-700/50 border-dashed"></div>
          <div className="w-full border-t border-slate-350 dark:border-slate-700/50 border-dashed"></div>
          <div className="w-full border-t border-slate-350 dark:border-slate-700/50 border-dashed"></div>
          <div className="w-full"></div> {/* الخط السفلي الحقيقي */}
        </div>

        {/* توليد الأعمدة بناءً على البيانات */}
        {chartData.map((item, index) => (
          <div key={index} className="flex-1 flex flex-col items-center h-full justify-end group/bar relative z-10">
            
            {/* الأعمدة المتجاورة (مبيعات ومشتريات) */}
            <div className="w-full flex items-end justify-center gap-1.5 h-full max-w-[45px]">
              {/* عمود المبيعات الشيكل */}
              <div className={`${item.sales} w-1/2 rounded-t bg-gradient-to-t from-emerald-500/80 to-teal-400 transition-all duration-500 ease-out origin-bottom group-hover/chart:scale-y-105 shadow-[0_0_15px_rgba(16,185,129,0.15)]`} />
              
              {/* عمود المشتريات الدولار */}
              <div className={`${item.purchases} w-1/2 rounded-t bg-gradient-to-t from-sky-500/80 to-indigo-400 transition-all duration-500 ease-out origin-bottom group-hover/chart:scale-y-105 shadow-[0_0_15px_rgba(14,165,233,0.15)]`} />
            </div>

            {/* اسم اليوم بالأسفل */}
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 font-bold font-arabic transition-colors duration-300 group-hover/bar:text-slate-800 dark:group-hover/bar:text-slate-300">
              {days[index]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

