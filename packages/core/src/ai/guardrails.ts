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

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces known people's names with "[name]" (security review S4). `fullNames` are matched whole (any client in
 * the workspace, for pasted text); `nameParts` word by word (the one client a check-in is from), parts of two
 * letters or fewer skipped.
 */
export function redactNames(
  text: string,
  names: { fullNames?: string[]; nameParts?: string[] },
): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  const full = [
    ...new Set((names.fullNames ?? []).map((n) => n.trim()).filter((n) => n.length >= 4)),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2000);
  const parts = [
    ...new Set((names.nameParts ?? []).map((n) => n.trim()).filter((n) => n.length >= 3)),
  ];
  for (const list of [full, parts]) {
    if (list.length === 0) continue;
    // Chunked so one regular expression never grows unbounded.
    for (let i = 0; i < list.length; i += 200) {
      const re = new RegExp(
        `(?<![\\p{L}\\p{N}])(?:${list
          .slice(i, i + 200)
          .map(escapeRe)
          .join('|')})(?![\\p{L}\\p{N}])`,
        'giu',
      );
      out = out.replace(re, () => {
        redactions++;
        return '[name]';
      });
    }
  }
  return { text: out, redactions };
}

/** The words of a person's name and their email's local part, for `redactNames`. */
export const namePartsOf = (name: string, email?: string | null): string[] => [
  ...name.split(/[\s,.'-]+/),
  ...(email ? email.split('@')[0]!.split(/[._+-]+/) : []),
];

/**
 * Best effort, not a guarantee (security review S5): a keyword screen for injury, medical, medication and
 * supplement content. The coach reviews every draft; this only removes the lines that are plainly out of scope.
 */
const UNSAFE = new RegExp(
  [
    'injur\\w*',
    'pain\\w*',
    'ache\\w*',
    'hurt\\w*',
    'sore\\w*',
    'dizz\\w*',
    'nause\\w*',
    'faint\\w*',
    'numb(?:ness)?',
    'tingl\\w*',
    'swell\\w*',
    'swollen',
    'flare\\w*',
    'cramp\\w*',
    'migraine\\w*',
    'headache\\w*',
    'ill(?:ness)?\\b',
    'sick\\w*',
    'concussion\\w*',
    'fractur\\w*',
    'hernia\\w*',
    'arthritis',
    'asthma\\w*',
    'heart condition',
    'chest pain',
    'medicine\\w*',
    'pill\\w*',
    'drug\\w*',
    'dose\\w*',
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
