import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { AccountDeletionError, accountDeletionMessage, confirmationMatches, deleteMyAccount } from '../accountDeletion';
import { accountDeletionInfo, privacyPolicy, renderPolicyHtml } from '../privacyPolicy';

describe('account deletion', () => {
  it('needs the account email typed exactly, ignoring case and spaces', () => {
    expect(confirmationMatches('  Owner@Shop.com ', 'owner@shop.com')).toBe(true);
    expect(confirmationMatches('owner@shop.co', 'owner@shop.com')).toBe(false);
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches('x', null)).toBe(false);
  });

  it('refuses without a session before calling the server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(deleteMyAccount('owner@shop.com')).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('explains every refusal, and unknown errors never claim success', () => {
    expect(accountDeletionMessage(new AccountDeletionError('founder_account'), true)).toContain('المؤسس');
    expect(accountDeletionMessage(new AccountDeletionError('pending_offline'), false)).toMatch(/not been sent/);
    expect(accountDeletionMessage(new Error('boom'), false)).toMatch(/could not be deleted/);
  });
});

describe('privacy policy', () => {
  it('states what staff see, what the assistant sends, and how to delete', () => {
    for (const ar of [true, false]) {
      const text = JSON.stringify(privacyPolicy(ar));
      expect(text).toContain('Gemini');
      expect(text).toContain('Google Play');
      expect(text).toContain('venusalhab@gmail.com');
    }
    const en = JSON.stringify(privacyPolicy(false));
    expect(en).toMatch(/do not show your books/);
    expect(en).toMatch(/Settings → Account/);
    expect(en).not.toMatch(/3D/);
  });

  it('renders a public page with escaped text and a language switch', () => {
    const html = renderPolicyHtml({ title: 'A <b>', updated: 'u', sections: [{ title: 'T&C', body: ['"x"'] }] }, false, '/privacy');
    expect(html).toContain('A &lt;b&gt;');
    expect(html).toContain('T&amp;C');
    expect(html).toContain('&quot;x&quot;');
    expect(html).toContain('lang="en" dir="ltr"');
    const ar = renderPolicyHtml(accountDeletionInfo(true), true, '/delete-account?lang=en');
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain('/delete-account?lang=en');
  });
});
