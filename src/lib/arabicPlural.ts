export interface ArabicPluralForms {
  one: string;
  two: string;
  few: string;
  many: string;
  /** Used for 0 and for 100, 101, 102, 1000… (noun in the singular). Falls back to `many`. */
  other?: string;
  zero?: string;
}

const rules = new Intl.PluralRules('ar');

/** Full Arabic count phrase; `{n}` in a form is replaced by the number. */
export function arCount(n: number, forms: ArabicPluralForms): string {
  let template: string;
  switch (rules.select(n)) {
    case 'zero':
      template = forms.zero ?? forms.other ?? forms.many;
      break;
    case 'one':
      template = forms.one;
      break;
    case 'two':
      template = forms.two;
      break;
    case 'few':
      template = forms.few;
      break;
    case 'many':
      template = forms.many;
      break;
    default:
      template = forms.other ?? forms.many;
  }
  return template.replace(/\{n\}/g, String(n));
}
