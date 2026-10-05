import { supabase } from '../supabaseClient';

export type TicketStatus = 'open' | 'answered' | 'closed';
export type TicketCategory = 'question' | 'problem' | 'billing' | 'suggestion';

export const TICKET_CATEGORIES: readonly TicketCategory[] = ['question', 'problem', 'billing', 'suggestion'];
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_BODY_MAX = 4000;

export interface SupportTicket {
  id: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: number;
  from_staff: boolean;
  body: string;
  created_at: string;
}

type SupportErrorCode =
  | 'not_installed' | 'offline' | 'invalid_subject' | 'invalid_message' | 'invalid_category'
  | 'too_many_open' | 'too_many_messages' | 'ticket_full' | 'not_found' | 'failed';

export class SupportError extends Error {
  constructor(public code: SupportErrorCode, message: string = code) {
    super(message);
  }
}

function supportError(error: { code?: string; message?: string }): SupportError {
  const message = error?.message || '';
  const pairs: Array<[RegExp, SupportErrorCode]> = [
    [/invalid subject/, 'invalid_subject'],
    [/invalid message/, 'invalid_message'],
    [/invalid category/, 'invalid_category'],
    [/too many open tickets/, 'too_many_open'],
    [/too many messages/, 'too_many_messages'],
    [/ticket is full/, 'ticket_full'],
    [/ticket not found/, 'not_found'],
    [/Failed to fetch|NetworkError|network/i, 'offline'],
  ];
  if (error?.code === 'PGRST202' || error?.code === '42883') return new SupportError('not_installed', message);
  const hit = pairs.find(([pattern]) => pattern.test(message));
  return new SupportError(hit ? hit[1] : 'failed', message);
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: any };
  try {
    result = await supabase.rpc(fn, args);
  } catch (error: any) {
    throw supportError(error);
  }
  if (result.error) throw supportError(result.error);
  return result.data as T;
}

export async function listMyTickets(): Promise<SupportTicket[]> {
  const rows = await call<SupportTicket[]>('support_my_tickets');
  return Array.isArray(rows) ? rows : [];
}

export function openTicket(category: TicketCategory, subject: string, body: string): Promise<string> {
  return call<string>('support_open', { p_category: category, p_subject: subject, p_body: body });
}

export async function loadThread(ticketId: string): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
  const data = await call<{ ticket: SupportTicket; messages: SupportMessage[] }>('support_thread', { p_ticket: ticketId });
  return { ticket: data.ticket, messages: Array.isArray(data.messages) ? data.messages : [] };
}

export async function replyToTicket(ticketId: string, body: string): Promise<void> {
  await call('support_reply', { p_ticket: ticketId, p_body: body });
}

export async function closeTicket(ticketId: string): Promise<void> {
  await call('support_close', { p_ticket: ticketId });
}

export function categoryLabel(category: TicketCategory, ar: boolean): string {
  const labels: Record<TicketCategory, [string, string]> = {
    question: ['سؤال عن الاستخدام', 'How-to question'],
    problem: ['مشكلة أو خطأ', 'Problem or bug'],
    billing: ['الاشتراك والدفع', 'Subscription & billing'],
    suggestion: ['اقتراح', 'Suggestion'],
  };
  return labels[category][ar ? 0 : 1];
}

export function ticketStatusLabel(status: TicketStatus, ar: boolean): string {
  if (status === 'open') return ar ? 'بانتظار الرد' : 'Waiting for reply';
  if (status === 'answered') return ar ? 'تم الرد' : 'Answered';
  return ar ? 'مغلق' : 'Closed';
}

export function supportErrorMessage(error: unknown, ar: boolean): string {
  const code = error instanceof SupportError ? error.code : 'failed';
  const messages: Record<SupportErrorCode, [string, string]> = {
    not_installed: ['خدمة الدعم غير مفعّلة على الخادم بعد. راسلنا على venusalhab@gmail.com', 'Support is not enabled on the server yet. Email venusalhab@gmail.com'],
    offline: ['لا يوجد اتصال بالإنترنت. أعد المحاولة عند الاتصال.', 'No internet connection. Try again when online.'],
    invalid_subject: [`اكتب عنواناً من 3 إلى ${TICKET_SUBJECT_MAX} حرفاً.`, `Write a subject of 3 to ${TICKET_SUBJECT_MAX} characters.`],
    invalid_message: [`اكتب رسالتك (حتى ${TICKET_BODY_MAX} حرف).`, `Write your message (up to ${TICKET_BODY_MAX} characters).`],
    invalid_category: ['اختر نوع الطلب.', 'Choose a request type.'],
    too_many_open: ['لديك 5 طلبات مفتوحة. أغلق ما حُلّ منها أو أكمل في أحدها.', 'You have 5 open requests. Close solved ones or continue in one of them.'],
    too_many_messages: ['وصلت إلى حد الرسائل اليومي (30). أكمل غداً أو راسلنا بالبريد.', 'You reached the daily message limit (30). Continue tomorrow or email us.'],
    ticket_full: ['هذه المحادثة طويلة جداً. افتح طلباً جديداً.', 'This conversation is too long. Open a new request.'],
    not_found: ['الطلب غير موجود.', 'Request not found.'],
    failed: ['تعذر إرسال الطلب. أعد المحاولة.', 'Could not send. Try again.'],
  };
  return messages[code][ar ? 0 : 1];
}
