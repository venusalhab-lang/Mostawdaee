import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Inbox, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  type StaffMessage, type StaffTicket, fetchStaffThread, fetchStaffTickets, replyAsStaff, setTicketStatus,
} from '../lib/adminSubscriptionApi';
import { TICKET_BODY_MAX, type TicketStatus, categoryLabel, ticketStatusLabel } from '../lib/supportTickets';

const statusTone: Record<TicketStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-100',
  answered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

function staffStatusLabel(status: TicketStatus, ar: boolean) {
  if (status === 'open') return ar ? 'بانتظار ردنا' : 'Needs reply';
  if (status === 'answered') return ar ? 'بانتظار العميل' : 'Waiting on customer';
  return ticketStatusLabel(status, ar);
}

function when(iso: string, ar: boolean) {
  return new Date(iso).toLocaleString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function subscriptionLabel(status: StaffTicket['store_subscription'], ar: boolean) {
  if (status === 'active') return ar ? 'مدفوع' : 'Paid';
  if (status === 'trial') return ar ? 'تجريبي' : 'Trial';
  if (status === 'expired') return ar ? 'منتهٍ' : 'Expired';
  return '—';
}

export default function AdminSupportInbox({ isRtl }: { isRtl: boolean }) {
  const [filter, setFilter] = useState<TicketStatus | 'all'>('open');
  const [tickets, setTickets] = useState<StaffTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tickets: rows } = await fetchStaffTickets(filter);
      setTickets(rows);
      setError(null);
    } catch (err: any) {
      setError(err?.message || (isRtl ? 'تعذر قراءة الطلبات' : 'Could not load tickets'));
    } finally {
      setLoading(false);
    }
  }, [filter, isRtl]);

  useEffect(() => { void load(); }, [load]);

  if (openId) {
    return <TicketThread id={openId} isRtl={isRtl} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['open', 'answered', 'closed', 'all'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-extrabold rounded-lg border cursor-pointer ${filter === f ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'text-slate-500 border-transparent hover:text-slate-900'}`}>
              {f === 'all' ? (isRtl ? 'الكل' : 'All') : staffStatusLabel(f, isRtl)}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-5 py-4 text-sm font-semibold">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        {loading ? (
          <div className="py-14 text-center"><RefreshCw className="h-6 w-6 text-indigo-600 animate-spin mx-auto" /></div>
        ) : tickets.length === 0 ? (
          <div className="py-14 text-center space-y-2">
            <Inbox size={22} className="mx-auto text-slate-400" />
            <p className="text-xs font-bold text-slate-500">{isRtl ? 'لا توجد طلبات هنا.' : 'No tickets here.'}</p>
          </div>
        ) : tickets.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpenId(t.id)}
            className="w-full text-start px-5 py-4 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center gap-2 cursor-pointer">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-900 truncate">{t.subject}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                <span>{categoryLabel(t.category, isRtl)}</span>
                <span className="mx-1.5">•</span>
                <span>{t.store_name || (isRtl ? 'متجر بلا اسم' : 'Unnamed store')}</span>
                <span className="mx-1.5">•</span>
                <span dir="ltr">{t.author_email}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className="text-slate-400">{when(t.updated_at, isRtl)}</span>
              <span className={`px-2 py-0.5 rounded-full border ${statusTone[t.status]}`}>{staffStatusLabel(t.status, isRtl)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TicketThread({ id, isRtl, onBack }: { id: string; isRtl: boolean; onBack: () => void }) {
  const [ticket, setTicket] = useState<StaffTicket | null>(null);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchStaffThread(id);
      setTicket(data.ticket);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || (isRtl ? 'تعذر قراءة الطلب' : 'Could not load the ticket'));
    }
  }, [id, isRtl]);

  useEffect(() => { void load(); }, [load]);

  const send = async (close: boolean) => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      await replyAsStaff(id, body, close);
      setReply('');
      toast.success(close ? (isRtl ? 'أُرسل الرد وأُغلق الطلب' : 'Replied and closed') : (isRtl ? 'أُرسل الرد' : 'Reply sent'));
      await load();
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر إرسال الرد' : 'Could not send'));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: TicketStatus) => {
    setBusy(true);
    try {
      await setTicketStatus(id, status);
      await load();
    } catch (err: any) {
      toast.error(err?.message || (isRtl ? 'تعذر تغيير الحالة' : 'Could not change the status'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-black text-slate-600 flex items-center gap-1.5 cursor-pointer">
        <ArrowRight size={14} className={isRtl ? '' : 'rotate-180'} />
        <span>{isRtl ? 'كل الطلبات' : 'All tickets'}</span>
      </button>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-5 py-4 text-sm font-semibold">{error}</div>}

      {ticket && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">{ticket.subject}</h2>
              <p className="text-xs text-slate-500 mt-1">{categoryLabel(ticket.category, isRtl)} • {when(ticket.created_at, isRtl)}</p>
            </div>
            <span className={`self-start px-2.5 py-1 rounded-full border text-[10px] font-bold ${statusTone[ticket.status]}`}>{staffStatusLabel(ticket.status, isRtl)}</span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs bg-slate-50 rounded-xl p-3">
            <div><dt className="text-slate-400 font-bold">{isRtl ? 'المرسل' : 'From'}</dt><dd className="font-black text-slate-800" dir="ltr">{ticket.author_email || '—'}</dd></div>
            <div><dt className="text-slate-400 font-bold">{isRtl ? 'المتجر' : 'Store'}</dt><dd className="font-black text-slate-800">{ticket.store_name || '—'}</dd></div>
            <div><dt className="text-slate-400 font-bold">{isRtl ? 'مالك المتجر' : 'Store owner'}</dt><dd className="font-black text-slate-800" dir="ltr">{ticket.store_owner_email || '—'}</dd></div>
            <div><dt className="text-slate-400 font-bold">{isRtl ? 'الاشتراك' : 'Subscription'}</dt><dd className="font-black text-slate-800">{subscriptionLabel(ticket.store_subscription, isRtl)}</dd></div>
          </dl>
        </div>
      )}

      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-3 border ${m.from_staff ? 'ms-auto bg-indigo-50 border-indigo-100' : 'bg-white border-slate-200'}`}>
            <p className="text-[10px] font-bold text-slate-500 mb-1">
              {m.from_staff ? <span dir="ltr">{m.staff_email}</span> : (isRtl ? 'العميل' : 'Customer')} • {when(m.created_at, isRtl)}
            </p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{m.body}</p>
          </div>
        ))}
      </div>

      {ticket && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, TICKET_BODY_MAX))}
            rows={4}
            placeholder={isRtl ? 'اكتب ردك للعميل' : 'Write your reply'}
            aria-label={isRtl ? 'الرد' : 'Reply'}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 outline-none focus:border-indigo-500"
          />
          <div className="flex flex-wrap gap-2 justify-end">
            {ticket.status === 'closed' ? (
              <button type="button" disabled={busy} onClick={() => void changeStatus('open')}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                {isRtl ? 'إعادة فتح' : 'Reopen'}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void changeStatus('closed')}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                {isRtl ? 'إغلاق دون رد' : 'Close without reply'}
              </button>
            )}
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send(true)}
              className="px-4 py-2 rounded-xl border border-indigo-200 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 cursor-pointer">
              {isRtl ? 'رد وإغلاق' : 'Reply & close'}
            </button>
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send(false)}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
              <Send size={13} />
              <span>{isRtl ? 'إرسال الرد' : 'Send reply'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
