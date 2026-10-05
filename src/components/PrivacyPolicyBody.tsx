import React from 'react';
import { privacyPolicy } from '../lib/privacyPolicy';

/** The privacy policy sections, shared by every screen that shows them and by the public /privacy page. */
export default function PrivacyPolicyBody({ ar }: { ar: boolean }) {
  const policy = privacyPolicy(ar);
  return (
    <div className="p-6 overflow-y-auto space-y-5 text-sm leading-relaxed text-gray-600 dark:text-gray-300 select-text" dir={ar ? 'rtl' : 'ltr'}>
      <p className="text-xs text-gray-400 font-medium">{policy.updated}</p>
      {policy.sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h4 className="font-bold text-sm text-gray-900 dark:text-white">{section.title}</h4>
          <ul className="space-y-1.5 list-disc ps-5">
            {section.body.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
