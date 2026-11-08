import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_CONTACT, LegalPage, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy | Repsy',
  description: 'What data Repsy processes, why, who can see it, and your rights.',
};

const mail = (
  <a href={`mailto:${LEGAL_CONTACT}`} className="text-accent underline underline-offset-4">
    {LEGAL_CONTACT}
  </a>
);

const PROCESSORS: [string, string, string][] = [
  ['Render', 'Hosting for the app, background jobs and database', 'United States'],
  [
    'Cloudflare',
    'Network protection, private storage for files and exports (R2), and streaming of coach demo videos',
    'Global',
  ],
  ['Resend', 'Sending account and notification emails', 'United States'],
  ['Sentry', 'Error reports, so we can fix problems', 'United States or European Union'],
  [
    'OpenAI',
    'The AI assistant, only if a workspace turns it on. Not used to train models',
    'United States',
  ],
  [
    'Google (Tag Manager and Analytics)',
    'Visitor statistics on the public home page, only if the visitor accepts cookies there',
    'United States',
  ],
  [
    'PostHog',
    'Product analytics with pseudonymous ids, only if turned on',
    'United States or European Union',
  ],
];

const SECTIONS: LegalSection[] = [
  {
    id: 'roles',
    title: 'Who is responsible',
    body: (
      <>
        <p>
          Repsy is coaching software. When a coach adds you as a client, <strong>your coach</strong>{' '}
          decides what to collect and why. They are the data controller (under India&rsquo;s Digital
          Personal Data Protection Act, the &ldquo;data fiduciary&rdquo;). <strong>Repsy</strong>{' '}
          processes that data on the coach&rsquo;s behalf.
        </p>
        <p>
          For coaches&rsquo; own accounts, and for visitors to our website, Repsy is the controller.
        </p>
      </>
    ),
  },
  {
    id: 'data',
    title: 'What we process',
    body: (
      <ul>
        <li>
          <strong>Account:</strong> name, email, password (stored only as a hash), sign-in sessions
          and devices, time zone and preferred units.
        </li>
        <li>
          <strong>Coaching data:</strong> goals, programs, workout logs (sets, reps, loads, effort,
          duration, distance), notes on workouts, check-in answers, habits, nutrition logs, body
          measurements, progress and assessment photos, messages, and group posts.
        </li>
        <li>
          <strong>Coach notes</strong> about a client, which the client cannot see.
        </li>
        <li>
          <strong>Agreements:</strong> which version a client accepted, when, and from which IP
          address.
        </li>
        <li>
          <strong>Business data</strong> for coaches: leads from their public page, packages and
          payment records.
        </li>
        <li>
          <strong>Technical data:</strong> security and audit logs (who did what and when, never the
          content of messages or answers), and error reports.
        </li>
        <li>
          <strong>Analytics</strong>, only if turned on: events such as &ldquo;workout
          completed&rdquo; with pseudonymous ids. Never names, emails, answers or messages.
        </li>
      </ul>
    ),
  },
  {
    id: 'health',
    title: 'Health-related data',
    body: (
      <>
        <p>
          Some data can say something about your health: check-in ratings of energy, sleep and
          stress, body measurements, progress photos and what you write to your coach. We treat it
          with extra care:
        </p>
        <ul>
          <li>We do not ask for injuries, medical history or medical clearance.</li>
          <li>Check-in answers and messages never go into analytics, logs or audit records.</li>
          <li>Photos are stored privately with location (GPS/EXIF) data removed.</li>
          <li>Only you and your coach&rsquo;s team can see it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'why',
    title: 'Why we use it',
    body: (
      <ul>
        <li>To provide the coaching tools your coach uses and the features you use.</li>
        <li>To send emails and notifications you need, such as invites, reminders and replies.</li>
        <li>To keep accounts and data secure, prevent abuse and fix errors.</li>
        <li>To understand which features are used and improve them (pseudonymous analytics).</li>
        <li>
          If a workspace owner turns on the AI assistant: to answer the coaching team&rsquo;s
          questions. The assistant reads only what a question needs. If the owner also allows it, it
          can propose changes (assigning programs, nutrition targets and meal plans) that only
          happen when a coach confirms them. Its conversations and proposals are deleted 90 days
          after their last message.
        </li>
        <li>To meet legal obligations.</li>
      </ul>
    ),
  },
  {
    id: 'sharing',
    title: 'Who can see it',
    body: (
      <>
        <ul>
          <li>You, and your coach and their team, according to their roles.</li>
          <li>
            Other members of a group you join see your first name and initial, your posts, and your
            leaderboard place if you choose to show it. Body measurements are never ranked.
          </li>
          <li>
            Repsy staff, only when needed for support, through an explicit, time-limited (24 hours)
            and audited access grant.
          </li>
          <li>The service providers below, only to run the Service.</li>
        </ul>
        <p>We do not sell your data and we do not use it for advertising.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Service providers</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Provider
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Purpose
                </th>
                <th scope="col" className="py-2 font-medium">
                  Location
                </th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map(([name, purpose, where]) => (
                <tr key={name} className="border-b border-border">
                  <td className="py-2 pr-4">{name}</td>
                  <td className="py-2 pr-4 text-secondary">{purpose}</td>
                  <td className="py-2 text-secondary">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Some providers are outside your country. Where the law requires it, transfers use
          safeguards such as standard contractual clauses.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <ul>
        <li>Each coaching workspace is isolated in the database (row-level security).</li>
        <li>Data is encrypted in transit (HTTPS) and files are stored privately.</li>
        <li>Two-step sign-in is available, and required for workspaces with a team.</li>
        <li>Emails and push notifications never carry your messages, answers or photos.</li>
      </ul>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <ul>
        <li>
          Coaching data is kept while you are a client of a coach who uses Repsy. Archived clients
          lose access, but data stays until deletion is requested or the coach closes their account.
        </li>
        <li>
          After a coach&rsquo;s plan lapses, clients keep read-only access and export for 90 days
          and the coach for 180 days.
        </li>
        <li>Backups expire within 35 days.</li>
        <li>
          We keep content-free audit records, payment records and anything the law requires us to
          keep for longer.
        </li>
      </ul>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <ul>
          <li>
            <strong>Export:</strong> download your data as CSV files from your Profile at any time.
          </li>
          <li>
            <strong>Deletion:</strong> request deletion from your Profile. Your coach is told, and
            we delete your data in that workspace, normally within 30 days. Other workspaces you
            belong to are not affected.
          </li>
          <li>
            <strong>Access, correction and objection:</strong> ask your coach, or write to {mail}.
          </li>
          <li>
            <strong>Complaints:</strong> you can complain to your data protection authority (in
            India, the Data Protection Board of India).
          </li>
        </ul>
        <p>
          If your coach is the controller, we pass your request to them and help them answer it.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: (
      <p>
        Inside the app and the client portal, Repsy uses only the cookies it needs to work: your
        sign-in session, your chosen workspace and your theme. The portal can store workouts on your
        device so you can log them offline. On the public home page only, we ask before using Google
        Analytics cookies (through Google Tag Manager) to count visits and see how visitors find us.
        If you decline, or do not choose, Google is not loaded at all. You can change your choice
        with &ldquo;Cookie settings&rdquo; at the bottom of the home page. We do not use advertising
        cookies.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        Repsy is for people aged 18 and over. Coaches must not add anyone younger without the
        consent of a parent or guardian where the law requires it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes',
    body: (
      <p>
        We will update the date at the top when this policy changes, and tell coaches about
        important changes by email or in the app. See also our{' '}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: <p>Privacy questions or requests: {mail}.</p>,
  },
];

/** Public Privacy Policy. */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what personal data Repsy processes, why, who can see it and the
          choices you have. Questions: {mail}.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
