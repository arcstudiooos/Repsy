/**
 * PRD I14 (D-013 #14): what never goes to the provider and what never comes back. Contact details are removed from
 * anything a coach pastes; output lines that touch medical, injury, medication or supplement topics are removed one
 * by one and counted, so the coach is told.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
// Seven or more digits with the usual phone separators (not "3x8 @ 60kg" or dates).
const PHONE = /(?:\+?\d[\d ().-]{6,}\d)/g;

export function redactContact(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const count = (re: RegExp) => (s: string) =>
    s.replace(re, (m) => {
      // Keep ordinary numbers: a phone has at least seven digits.
      if (re === PHONE && m.replace(/\D/g, '').length < 7) return m;
      redactions++;
      return re === EMAIL ? '[email removed]' : re === URL ? '[link removed]' : '[number removed]';
    });
  const out = count(PHONE)(count(URL)(count(EMAIL)(text)));
  return { text: out, redactions };
}

const UNSAFE = new RegExp(
  [
    'injur\\w*',
    'pain\\w*',
    'ache\\w*',
    'sprain\\w*',
    'strain(?:ed)?',
    'tendon\\w*',
    'tear',
    'physio\\w*',
    'rehab\\w*',
    'diagnos\\w*',
    'medic\\w*',
    'prescri(?:be|bed|ption)\\w*',
    'doctor\\w*',
    'surgery',
    'surgical',
    'therap\\w*',
    'symptom\\w*',
    'disease\\w*',
    'diabet\\w*',
    'blood pressure',
    'pregnan\\w*',
    'supplement\\w*',
    'creatine',
    'caffeine',
    'pre-?workout',
    'protein (?:powder|shake)s?',
    'vitamin\\w*',
    'steroid\\w*',
    'ibuprofen',
    'paracetamol',
    'painkiller\\w*',
    'dosage',
    'mg\\b',
  ]
    .map((t) => `\\b${t}`)
    .join('|'),
  'i',
);

export const isUnsafe = (line: string): boolean => UNSAFE.test(line);

export function filterUnsafe(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split('\n').filter((l) => {
    if (isUnsafe(l)) {
      removed++;
      return false;
    }
    return true;
  });
  return { text: kept.join('\n'), removed };
}

export const REMOVED_NOTE = (n: number) =>
  n === 0
    ? null
    : `${n} ${n === 1 ? 'line was' : 'lines were'} removed because ${
        n === 1 ? 'it' : 'they'
      } touched on injury, medical or supplement topics. Add anything like that yourself.`;
