import type { Metadata } from 'next';
import Link from 'next/link';
import { TRIAL_CLIENT_LIMIT, TRIAL_DAYS } from '@kinetic/core';
import { LEGAL_CONTACT, LegalPage, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service | Repsy',
  description: 'The terms that apply when you use Repsy as a coach or as a client.',
};

const mail = (
  <a href={`mailto:${LEGAL_CONTACT}`} className="text-accent underline underline-offset-4">
    {LEGAL_CONTACT}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement',
    body: (
      <>
        <p>
          These terms are an agreement between you and Repsy (&ldquo;Repsy&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;) for the use of the Repsy website, web app and client portal (the
          &ldquo;Service&rdquo;). By creating an account, accepting an invite or using the Service,
          you agree to these terms and to our <Link href="/privacy">Privacy Policy</Link>. If you
          use Repsy for a business, you accept these terms for that business.
        </p>
        <p>
          You must be at least 18 years old, or the age of majority where you live, to use Repsy.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'What Repsy is',
    body: (
      <>
        <p>
          Repsy is software for fitness coaches. <strong>Coaches</strong> build programs, manage
          clients, send check-ins and messages, and run their coaching business.{' '}
          <strong>Clients</strong> are invited by a coach and use the portal to train, log workouts,
          check in and message their coach.
        </p>
        <p>
          Your coach&rsquo;s business, not Repsy, provides the coaching. Repsy provides the tools.
          We are not party to the arrangement between a coach and their clients.
        </p>
      </>
    ),
  },
  {
    id: 'health',
    title: 'Health and safety',
    body: (
      <>
        <p>
          <strong>Repsy does not give medical advice.</strong> Programs, messages and feedback come
          from your coach, not from Repsy. Talk to a doctor before starting a new exercise program,
          especially if you have an injury or a medical condition. Stop exercising and get medical
          help if you feel pain, dizziness or shortness of breath.
        </p>
        <p>
          The AI assistant answers a coach&rsquo;s questions from their workspace data. Its answers
          can be wrong: the coach checks them and is responsible for anything they send or assign.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <ul>
        <li>Give accurate details and keep your password and backup codes safe.</li>
        <li>
          You are responsible for activity on your account. Tell us at once at {mail} if you think
          someone else has used it.
        </li>
        <li>Workspace owners decide who joins their team and what role each person has.</li>
        <li>We may require two-step sign-in for workspaces with a team.</li>
      </ul>
    ),
  },
  {
    id: 'coaches',
    title: 'Coach responsibilities',
    body: (
      <>
        <p>If you use Repsy as a coach, you also agree that:</p>
        <ul>
          <li>
            You are responsible for the coaching you provide, for your qualifications and insurance,
            and for complying with the laws that apply to your business.
          </li>
          <li>
            You decide which client data to collect and why. You act as the data controller (or
            &ldquo;data fiduciary&rdquo;) for your clients&rsquo; data and Repsy processes it on
            your behalf, as described in the <Link href="/privacy">Privacy Policy</Link>.
          </li>
          <li>
            You have a lawful basis, and where needed your clients&rsquo; consent, to add them to
            Repsy and to send them messages through it.
          </li>
          <li>
            Agreements and waivers you publish in Repsy are yours. Repsy records that a client
            accepted them but does not review their content.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <>
        <p>Do not use Repsy to:</p>
        <ul>
          <li>break the law, or infringe anyone&rsquo;s privacy or intellectual property;</li>
          <li>upload content that is unlawful, harassing, hateful or sexually explicit;</li>
          <li>send spam or messages people did not agree to receive;</li>
          <li>
            probe, scan or test the Service&rsquo;s security, or access data that is not yours,
            without our written permission;
          </li>
          <li>disrupt the Service, overload it, or get around usage limits;</li>
          <li>copy, resell or reverse engineer the Service.</li>
        </ul>
        <p>
          Group members can report posts and comments. Coaches moderate their own groups. We may
          remove content or suspend accounts that break these rules.
        </p>
      </>
    ),
  },
  {
    id: 'content',
    title: 'Your content',
    body: (
      <>
        <p>
          You keep ownership of what you put into Repsy: programs, workout logs, check-in answers,
          messages, photos and files. You give us permission to store, process and display that
          content only as needed to run the Service for you and the people you share it with.
        </p>
        <p>
          You can export your data at any time: clients from their Profile, workspace owners from
          Settings. See the <Link href="/privacy">Privacy Policy</Link> for deletion.
        </p>
      </>
    ),
  },
  {
    id: 'trial',
    title: 'Trial, plans and payment',
    body: (
      <>
        <p>
          New coach workspaces get a free {TRIAL_DAYS}-day trial for up to {TRIAL_CLIENT_LIMIT}{' '}
          active clients, with no card needed. When the trial ends you keep your clients and data,
          but you cannot add new clients until you choose a plan. Pilot workspaces keep the access
          their pilot code gave them.
        </p>
        <p>
          Paid plans, prices and taxes are shown before you pay. Our{' '}
          <Link href="/plan">fair-billing charter</Link> applies: one price with everything
          included, cancel at any time from Settings, and pro-rated refunds for unused time. Prices
          may change with at least 30 days&rsquo; notice.
        </p>
        <p>
          Payments a client makes to a coach for coaching (packages, sessions) are between the
          client and the coach. The coach sets their own prices, refunds and taxes.
        </p>
      </>
    ),
  },
  {
    id: 'ending',
    title: 'Cancelling and ending',
    body: (
      <>
        <p>
          You can stop using Repsy at any time. Coaches can cancel their plan from Settings. If a
          coach&rsquo;s plan lapses, clients keep read-only access and data export for 90 days and
          the coach for 180 days.
        </p>
        <p>
          We may suspend or close an account that seriously or repeatedly breaks these terms, or
          where the law requires it. Where we can, we will tell you first and give you the chance to
          export your data.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <p>
        We work to keep Repsy available and secure, and we post incidents on our{' '}
        <Link href="/status">status page</Link>. The Service may sometimes be unavailable for
        maintenance or reasons outside our control. We improve Repsy over time and may add, change
        or remove features. If we remove something important you rely on, we will give reasonable
        notice.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Disclaimers and liability',
    body: (
      <>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent
          the law allows, we make no promises beyond those in these terms.
        </p>
        <p>
          To the extent the law allows, Repsy is not liable for indirect or consequential loss, for
          loss of profit or data, or for injury that results from coaching or exercise. Our total
          liability for any claim is limited to the amount you paid us in the 12 months before the
          claim, or INR 5,000 if you paid nothing. Nothing in these terms limits liability that
          cannot be limited by law.
        </p>
      </>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: (
      <p>
        These terms are governed by the laws of India. Courts in India have jurisdiction, unless the
        consumer law of the country you live in gives you the right to bring a claim there. Before
        going to court, please write to {mail} so we can try to resolve the problem.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. We will change the date at the top and, for important changes,
        tell coaches by email or in the app at least 14 days before they apply. If you keep using
        Repsy after that, the new terms apply.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: <p>Questions about these terms: {mail}.</p>,
  },
];

/** Public Terms of Service. */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms cover how coaches and their clients may use Repsy. They are written to be
          read: if anything is unclear, email {mail}.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
