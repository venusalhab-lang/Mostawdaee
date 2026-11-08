/** Shared visual tokens for the Mostawdaee platform operations console. */

/** Fits inside the app chrome (header + ticker + bottom dock) on phones; expands on desktop. */
export const opsShell =
  'relative min-h-0 w-full max-w-full mx-0 rounded-2xl sm:rounded-[1.75rem] overflow-hidden ' +
  'bg-[#070b14] text-slate-100 border border-white/[0.06] ' +
  'shadow-[0_0_0_1px_rgba(34,211,238,0.04),0_24px_80px_-40px_rgba(0,0,0,0.7)] ' +
  'sm:-mx-2 lg:-mx-4';

export const opsAmbient =
  'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.08),_transparent_55%),radial-gradient(ellipse_at_bottom_left,_rgba(16,185,129,0.05),_transparent_40%)]';

export const opsGrid =
  'pointer-events-none absolute inset-0 opacity-[0.035] ' +
  '[background-image:linear-gradient(rgba(148,163,184,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.5)_1px,transparent_1px)] ' +
  '[background-size:48px_48px]';

export const opsCard =
  'rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm';

export const opsCardPad = `${opsCard} p-4 sm:p-5`;

export const opsInput =
  'w-full min-w-0 px-4 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm font-bold text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20';

export const opsBtnGhost =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 ' +
  'bg-white/[0.03] text-slate-300 text-xs font-bold hover:bg-white/[0.06] hover:text-white ' +
  'disabled:opacity-50 cursor-pointer transition-colors';

export const opsBtnPrimary =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl ' +
  'bg-cyan-500 hover:bg-cyan-400 text-[#041018] text-xs font-black disabled:opacity-50 cursor-pointer transition-colors';

export const opsError =
  'rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 sm:px-5 py-3.5 sm:py-4 text-sm font-semibold text-rose-200 break-words';

export const opsMuted = 'text-slate-400';

export const opsTableHead =
  'bg-black/30 text-slate-400 border-b border-white/[0.06] h-11';

export const opsChip = (active: boolean) =>
  active
    ? 'px-3 py-1.5 text-xs font-extrabold rounded-lg border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 cursor-pointer'
    : 'px-3 py-1.5 text-xs font-extrabold rounded-lg border border-transparent text-slate-500 hover:text-slate-200 cursor-pointer';

export const opsStatus = {
  active: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25',
  trial: 'bg-amber-500/10 text-amber-200 border-amber-400/25',
  expired: 'bg-rose-500/10 text-rose-200 border-rose-400/25',
  idle: 'bg-white/5 text-slate-400 border-white/10',
} as const;
