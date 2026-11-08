/**
 * Marketing site content (landing PRD rev 2). Every claim here must be true in the product, or marked `soon`.
 * Copy follows PRD §8: specific, short, sentence case, no banned words (marketing-content.test.ts checks).
 */

/** Plans: set by the founder on 2026-11-05 (from docs/competitive/complete-platform-prd.md §Pricing). */
/**
 * Product tour (PRD §5 hero, §9). Put the files in apps/web/public/tour/ and set the paths: the slot on the page
 * switches from "coming soon" to the player, and the hero's second button becomes "See a 2-minute tour".
 * Captions are required (WCAG 1.2.2), so the player only shows when `captions` is set too.
 */
export const TOUR_VIDEO: {
  src: string | null;
  captions: string | null;
  poster: string | null;
  length: string;
} = {
  src: null, // e.g. '/tour/repsy-tour.mp4'
  captions: null, // e.g. '/tour/repsy-tour.en.vtt'
  poster: null, // e.g. '/tour/repsy-tour-poster.jpg'
  length: '2 minutes',
};

/** Where coaches ask for a paid plan until online checkout exists (go-live review 2026-11-08). */
export const PLAN_CONTACT = 'hello@repsy.fit';
export const planMailto = (plan: string) =>
  `mailto:${PLAN_CONTACT}?subject=${encodeURIComponent(`Repsy ${plan} plan`)}`;

export const PLANS = [
  {
    id: 'trial',
    name: 'Free trial',
    clients: 3,
    seats: 1,
    monthly: 0,
    annual: 0,
    blurb: 'Every feature for 7 days with your first clients.',
  },
  {
    id: 'solo',
    name: 'Solo',
    clients: 30,
    seats: 1,
    monthly: 39,
    annual: 390,
    blurb: 'One coach, a full roster.',
    featured: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    clients: 100,
    seats: 3,
    monthly: 89,
    annual: 890,
    blurb: 'A coach with assistants.',
  },
  {
    id: 'studio',
    name: 'Studio',
    clients: 300,
    seats: 10,
    monthly: 199,
    annual: 1990,
    blurb: 'Studios and coaching teams.',
  },
] as const;

export const INCLUDED = [
  'Programs and workout logging',
  'Offline logging with sync state',
  'Check-ins and forms',
  'Messages with photo, video and PDF',
  'Nutrition targets and meal plans',
  'Habits and tasks',
  'Review queue and analytics',
  'Automations',
  'Scheduling and session packs',
  'Full data export',
] as const;

export interface Promise {
  n: string;
  title: string;
  body: string;
  /** Not shipped to coaches yet: shown with a "Coming soon" tag (PRD §3.1: never imply it exists). */
  soon?: boolean;
}

/** PRD §3.1, checked against what ships today (see the PR for the audit). */
export const PROMISES: Promise[] = [
  {
    n: '01',
    title: 'Never lose a log.',
    body: 'Clients log with no signal. Each set shows Saved on device, Syncing or Synced, so nobody guesses.',
  },
  {
    n: '02',
    title: 'One price, everything in it.',
    body: 'Automation, nutrition, scheduling and video are on every plan. Plans differ by client count only.',
  },
  {
    n: '03',
    title: 'Leave or arrive in an afternoon.',
    body: 'Export clients, workouts, every logged set, check-ins and messages as CSV. Import a roster from a spreadsheet, and ask us to help move the rest.',
  },
  {
    n: '04',
    title: 'Coaching that feels personal.',
    body: 'Every check-in opens with the week around it: sessions done, notes, messages and the last reply.',
  },
  {
    n: '05',
    title: 'An assistant that knows your roster.',
    body: 'Ask about any client, program or week. Off by default, and it only reads.',
  },
  {
    n: '06',
    title: 'Fair billing, no lock-outs.',
    body: 'If a plan lapses, clients keep read access to their history for 90 days, and so do you.',
  },
];

export const LOOP = [
  {
    id: 'invite',
    label: 'Invite',
    title: 'Invite a client in one step',
    points: [
      'Send an invite link by email',
      'Import a roster from CSV',
      'Clients accept and land on their home screen',
    ],
  },
  {
    id: 'program',
    label: 'Program',
    title: 'Build the block once',
    points: [
      'Weeks × days grid with drag to reorder',
      'Sets, reps, RPE, tempo and rest',
      'Save a version; past logs keep theirs',
    ],
  },
  {
    id: 'train',
    label: 'Train',
    title: 'Clients log in seconds',
    points: [
      'Previous performance in every row',
      'Rest timer between sets',
      'Works offline, syncs when back online',
    ],
  },
  {
    id: 'review',
    label: 'Review',
    title: 'See who needs you today',
    points: [
      'Missed and unfinished workouts flagged',
      'Snooze or resolve with a reason',
      'Every flag links to the context',
    ],
  },
  {
    id: 'checkin',
    label: 'Check in',
    title: 'Weekly check-ins that get answered',
    points: [
      'Scheduled per client, in their time zone',
      'Drafts save as they type',
      'Answers side by side with past weeks',
    ],
  },
  {
    id: 'act',
    label: 'Act',
    title: 'Reply, adjust, repeat',
    points: [
      'Message from the check-in',
      'Swap an exercise for one client',
      'Track adherence week over week',
    ],
  },
] as const;

export interface CompareSource {
  label: string;
  url: string;
}

export interface Competitor {
  slug: string;
  name: string;
  /** What each row costs or whether it's built in, in plain neutral words (PRD §4.3). */
  cells: Record<CompareRowId, string>;
  sources: CompareSource[];
  /** ISO date the figures were last checked. Older than 120 days fails the build (marketing-content.test.ts). */
  lastVerified: string;
}

export const COMPARE_ROWS = [
  { id: 'base', label: 'Base price, 30 clients' },
  { id: 'automation', label: 'Automation' },
  { id: 'payments', label: 'Client payments' },
  { id: 'nutrition', label: 'Nutrition and meal plans' },
  { id: 'video', label: 'Video in programs' },
] as const;
export type CompareRowId = (typeof COMPARE_ROWS)[number]['id'];

/** Repsy's own column: what ships today. */
export const REPSY_CELLS: Record<CompareRowId, string> = {
  base: '$39',
  automation: 'Included',
  payments: 'Coming soon',
  nutrition: 'Included',
  video: 'Included',
};

/**
 * Third-party figures from docs/competitive/complete-platform-prd.md (Pricing). They are not yet confirmed against
 * each vendor's own pricing page (PRD §4.3): the table says so, and legal review is still required before launch.
 */
export const COMPETITORS: Competitor[] = [
  {
    slug: 'trainerize',
    name: 'Trainerize',
    cells: {
      base: 'Varies by plan',
      automation: 'Higher plans',
      payments: 'Add-on, $10/mo',
      nutrition: 'Add-on, $20–45/mo',
      video: 'Add-on, $10/mo',
    },
    sources: [
      {
        label: 'Coachway: Trainerize pricing',
        url: 'https://coachway.io/articles/trainerize-pricing/',
      },
    ],
    lastVerified: '2026-11-05',
  },
  {
    slug: 'everfit',
    name: 'Everfit',
    cells: {
      base: 'From about $19',
      automation: 'Add-on, $29/mo',
      payments: 'Add-on, $9/mo',
      nutrition: 'Built in',
      video: 'On-demand add-on, $25/mo',
    },
    sources: [
      {
        label: 'ProMealPlan: Everfit review',
        url: 'https://www.promealplan.com/en/blog/everfit-review-2026',
      },
    ],
    lastVerified: '2026-11-05',
  },
  {
    slug: 'truecoach',
    name: 'TrueCoach',
    cells: {
      base: 'About $49–58 for 20',
      automation: 'Limited',
      payments: 'Not in every region',
      nutrition: 'Not built in',
      video: 'Built in',
    },
    sources: [
      {
        label: 'ProMealPlan: TrueCoach review',
        url: 'https://www.promealplan.com/en/blog/truecoach-review-2026',
      },
    ],
    lastVerified: '2026-11-05',
  },
  {
    slug: 'kahunas',
    name: 'Kahunas',
    cells: {
      base: '$35 for 25',
      automation: 'Higher plan, $69 for 50',
      payments: 'Built in',
      nutrition: 'Built in',
      video: 'Built in',
    },
    sources: [
      { label: 'Coachway: Kahunas pricing', url: 'https://coachway.io/articles/kahunas-pricing/' },
    ],
    lastVerified: '2026-11-05',
  },
  {
    slug: 'spurfit',
    name: 'Spur.fit',
    cells: {
      base: '$49 for 20',
      automation: 'Built in',
      payments: 'Built in',
      nutrition: 'Built in',
      video: 'Built in',
    },
    sources: [{ label: 'G2: Spur.fit pricing', url: 'https://g2.com/products/spur-fit/pricing' }],
    lastVerified: '2026-11-05',
  },
];

export const SWITCH_FROM = [
  'Trainerize',
  'Everfit',
  'TrueCoach',
  'Kahunas',
  'Spur.fit',
  'Spreadsheets',
] as const;

export const TRUST = [
  {
    title: 'Private by default',
    body: 'Check-ins, photos and body metrics never go to analytics or email. Coaches see only their own clients.',
  },
  {
    title: 'Accessible',
    body: 'Built to WCAG 2.2 AA and checked with axe on every main screen, in light and dark.',
  },
  {
    title: 'Yours to take',
    body: 'Export clients, workouts, logged sets, check-ins and messages as CSV whenever you like.',
  },
  {
    title: 'Honest status',
    body: 'Every logged set shows whether it is on the device or on our servers. Nothing is hidden.',
  },
] as const;

export const FAQ = [
  {
    q: 'How do I move my clients from another app?',
    a: 'Export a client list from your current app as CSV and import it on the Clients page. For programs and history, contact us and we will help you move them.',
  },
  {
    q: 'Do my clients need to download an app?',
    a: 'No. Clients open Repsy in the browser and can add it to their home screen. It works offline, so logging in a basement gym is fine.',
  },
  {
    q: 'What happens if I cancel?',
    a: 'You can export everything first. After a plan lapses, you and your clients keep read access to past history for 90 days.',
  },
  {
    q: 'Does it work for in-person and hybrid coaching?',
    a: 'Yes. Book sessions, sell session packs and log a workout for a client from your phone during the session.',
  },
  {
    q: 'Is there AI in Repsy?',
    a: 'Yes: an AI assistant you can ask about your clients, programs, check-ins and business. It is off until a workspace owner turns it on, it can only read, and it never messages anyone for you.',
  },
  {
    q: 'Can I take payments from clients?',
    a: 'Client payments are coming soon. Until then you can record payments you take elsewhere against a client.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In a managed Postgres database in the United States, separated per coaching business at the database level.',
  },
] as const;
