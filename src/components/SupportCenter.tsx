import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, LifeBuoy, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useFirebase } from './FirebaseProvider';
import {
  type SupportMessage, type SupportTicket, type TicketCategory, TICKET_BODY_MAX, TICKET_CATEGORIES, TICKET_SUBJECT_MAX,
  categoryLabel, closeTicket, listMyTickets, loadThread, openTicket, replyToTicket, supportErrorMessage, ticketStatusLabel,
} from '../lib/supportTickets';

const card = 'p-6 sm:p-8 bg-gray-50 dark:bg-gray-800/50 rounded-[2rem] border border-gray-200 dark:border-gray-700/50';
const input = 'w-full px-4 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-900 dark:text-white outline-none focus:border-indigo-500';
const primary = 'px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-black transition flex items-center justify-center gap-2 cursor-pointer';
const quiet = 'px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 text-xs font-black text-gray-700 dark:text-gray-200 transition flex items-center justify-center gap-2 cursor-pointer';

const statusTone = {
  open: 'text-amber-600',
  answered: 'text-emerald-600',
  closed: 'text-gray-500',
} as const;

function when(iso: string, ar: boolean) {
  return new Date(iso).toLocaleString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Questions and problems sent to the Mostawdaee team, with their replies. */
export default function SupportCenter({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar';
  const { user } = useFirebase();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'new' | string>('list');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTickets(await listMyTickets());
      setLoadError(null);
    } catch (error) {
      setLoadError(supportErrorMessage(error, ar));
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
  }, [user, load]);

  if (!user) {
    return (
      <div className={card}>
        <p className="text-sm font-bold text-gray-600 dark:text-gray-300">
          {ar ? 'سجّل الدخول لمراسلة فريق الدعم، أو راسلنا على venusalhab@gmail.com' : 'Sign in to message support, or email venusalhab@gmail.com'}
        </p>
      </div>
    );
  }

  const back = () => { setView('list'); void load(); };

  return (
    <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LifeBuoy className="text-indigo-600" />
          <h2 className="text-2xl font-black text-gray-900 dark:text-white">{ar ? 'الدعم الفني' : 'Support'}</h2>
        </div>
        {view === 'list' && (
          <button type="button" onClick={() => setView('new')} className={primary}>
            <Plus size={16} />
            <span>{ar ? 'طلب جديد' : 'New request'}</span>
          </button>
        )}
      </div>

      {view === 'new' ? (
        <NewTicket ar={ar} onCancel={() => setView('list')} onCreated={(id) => setView(id)} />
      ) : view !== 'list' ? (
        <Thread id={view} ar={ar} onBack={back} />
      ) : (
        <div className={card}>
          {loading ? (
            <p className="text-sm text-gray-500">{ar ? 'جارٍ التحميل...' : 'Loading...'}</p>
          ) : loadError ? (
            <p className="text-sm font-bold text-rose-600">{loadError}</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {ar
                ? 'اسأل عن أي شيء في استخدام مستودعي أو أبلغ عن مشكلة، ويرد عليك فريقنا هنا. لا يرى الفريق دفاتر متجرك، فاكتب التفاصيل التي تساعدنا على الفهم.'
                : 'Ask anything about using Mostawdaee or report a problem, and our team replies here. The team cannot see your books, so include the details that help us understand.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setView(t.id)} className="w-full text-start py-4 flex items-center gap-3 cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-gray-900 dark:text-white truncate">{t.subject}</p>
                      <p className="text-xs text-gray-500 mt-1">{categoryLabel(t.category, ar)} • {when(t.updated_at, ar)}</p>
                    </div>
                    <span className={`text-xs font-black ${statusTone[t.status]}`}>{ticketStatusLabel(t.status, ar)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NewTicket({ ar, onCancel, onCreated }: { ar: boolean; onCancel: () => void; onCreated: (id: string) => void }) {
  const [category, setCategory] = useState<TicketCategory>('question');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const id = await openTicket(category, subject.trim(), body.trim());
      toast.success(ar ? 'أُرسل طلبك. ستجد الرد هنا.' : 'Request sent. The reply will appear here.');
      onCreated(id);
    } catch (error) {
      toast.error(supportErrorMessage(error, ar));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={input} aria-label={ar ? 'نوع الطلب' : 'Request type'}>
        {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, ar)}</option>)}
      </select>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value.slice(0, TICKET_SUBJECT_MAX))}
        required
        minLength={3}
        placeholder={ar ? 'العنوان، مثل: لا تظهر الفاتورة بعد البيع' : 'Subject, e.g. The invoice does not appear after a sale'}
        aria-label={ar ? 'العنوان' : 'Subject'}
        className={input}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, TICKET_BODY_MAX))}
        required
        rows={6}
        placeholder={ar ? 'اشرح ما حدث، وما الشاشة التي كنت فيها، وماذا توقعت أن يحدث.' : 'Describe what happened, which screen you were on, and what you expected.'}
        aria-label={ar ? 'الرسالة' : 'Message'}
        className={input}
      />
      <div className="flex flex-col sm:flex-row gap-3 justify-end">
        <button type="button" onClick={onCancel} className={quiet}>{ar ? 'إلغاء' : 'Cancel'}</button>
        <button type="submit" disabled={busy || subject.trim().length < 3 || !body.trim()} className={primary}>
          <Send size={15} />
          <span>{busy ? (ar ? 'جارٍ الإرسال...' : 'Sending...') : (ar ? 'إرسال' : 'Send')}</span>
        </button>
      </div>
    </form>
  );
}

function Thread({ id, ar, onBack }: { id: string; ar: boolean; onBack: () => void }) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await loadThread(id);
      setTicket(data.ticket);
      setMessages(data.messages);
      setError(null);
    } catch (err) {
      setError(supportErrorMessage(err, ar));
    }
  }, [id, ar]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      await replyToTicket(id, body);
      setReply('');
      await load();
    } catch (err) {
      toast.error(supportErrorMessage(err, ar));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      await closeTicket(id);
      toast.success(ar ? 'أُغلق الطلب.' : 'Request closed.');
      await load();
    } catch (err) {
      toast.error(supportErrorMessage(err, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-black text-gray-600 dark:text-gray-300 flex items-center gap-1.5 cursor-pointer">
        <ArrowRight size={14} className={ar ? '' : 'rotate-180'} />
        <span>{ar ? 'كل الطلبات' : 'All requests'}</span>
      </button>
      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
      {ticket && (
        <div className={`${card} space-y-1`}>
          <h3 className="text-lg font-black text-gray-900 dark:text-white">{ticket.subject}</h3>
          <p className="text-xs text-gray-500">
            {categoryLabel(ticket.category, ar)} • <span className={`font-black ${statusTone[ticket.status]}`}>{ticketStatusLabel(ticket.status, ar)}</span>
          </p>
        </div>
      )}
      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-3 border ${m.from_staff
            ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20'
            : 'ms-auto bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'}`}>
            <p className="text-[10px] font-bold text-gray-500 mb-1">
              {m.from_staff ? (ar ? 'فريق مستودعي' : 'Mostawdaee team') : (ar ? 'أنت' : 'You')} • {when(m.created_at, ar)}
            </p>
            <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{m.body}</p>
          </div>
        ))}
      </div>
      {ticket && (
        <div className={`${card} space-y-3`}>
          {ticket.status === 'closed' && (
            <p className="text-xs text-gray-500">{ar ? 'الطلب مغلق. إن كتبت رداً يُعاد فتحه.' : 'This request is closed. Replying reopens it.'}</p>
          )}
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, TICKET_BODY_MAX))}
            rows={3}
            placeholder={ar ? 'اكتب ردك' : 'Write a reply'}
            aria-label={ar ? 'الرد' : 'Reply'}
            className={input}
          />
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            {ticket.status !== 'closed' && (
              <button type="button" disabled={busy} onClick={() => void close()} className={quiet}>
                {ar ? 'تم حل المشكلة، أغلق الطلب' : 'Solved, close the request'}
              </button>
            )}
            <button type="button" disabled={busy || !reply.trim()} onClick={() => void send()} className={primary}>
              <Send size={15} />
              <span>{ar ? 'إرسال' : 'Send'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
