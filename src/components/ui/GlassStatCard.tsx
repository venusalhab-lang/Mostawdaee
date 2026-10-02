import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number | React.ReactNode;
  subText?: string;
  icon?: React.ReactNode;
  trend?: {
    type: 'up' | 'down';
    text: string;
  };
  onClick?: () => void;
}

export function GlassStatCard({ title, value, subText, icon, trend, onClick }: StatCardProps) {
  return (
    <div 
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/80 p-6 shadow-sm backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-md dark:border-white/10 dark:bg-slate-800/30 dark:shadow-2xl dark:hover:border-white/20 dark:hover:bg-slate-800/40 will-change-transform ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      
      {/* تأثير الإضاءة الخلفية الناعمة عند الـ Hover */}
      <div className="absolute -inset-px bg-gradient-to-br from-blue-500/5 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 dark:from-white/5 pointer-events-none" />
      
      <div className="flex items-center justify-between relative z-10">
        <div className="flex-1 min-w-0">
          {/* نص رمادي داكن واضح جداً */}
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors font-arabic truncate">
            {title}
          </p>
          
          {/* أرقام بلون أزرق داكن فخم ومريحة للعين */}
          <h3 className="text-2xl font-bold text-slate-800 dark:text-white mt-1.5 font-mono tracking-tight">
            {value}
          </h3>
          
          {/* المحتوى السفلي: النصوص المساعدة أو مؤشر التوجه */}
          {(subText || trend) && (
            <div className="flex items-center gap-2 mt-2 text-[11px] font-arabic overflow-hidden">
              {subText && (
                <span className="text-slate-400 dark:text-slate-500 font-medium truncate">
                  {subText}
                </span>
              )}
              {trend && (
                <span className={`font-bold px-2 py-0.5 rounded-full text-[10px] shrink-0 ${
                  trend.type === 'up' 
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20' 
                    : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 border border-rose-100 dark:border-rose-500/20'
                }`}>
                  {trend.type === 'up' ? '↑' : '↓'} {trend.text}
                </span>
              )}
            </div>
          )}
        </div>

        {icon && (
          <div className="p-3 bg-blue-50 text-blue-600 dark:bg-white/5 dark:text-blue-400 rounded-xl group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-500 dark:group-hover:text-white transition-all shrink-0 ms-4 group-hover:[&_svg]:text-white">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

