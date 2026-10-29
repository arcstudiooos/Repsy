'use client';

import { SectionForm } from './form';

/** Message-email and marketing opt-ins (both off by default). Shared by the coach and portal pages. */
export function NotificationsSection({
  notifications,
}: {
  notifications: { messageEmailOptIn: boolean; marketingOptIn: boolean };
}) {
  return (
    <SectionForm
      title="Notifications"
      description="Account emails like verification and password reset are always sent."
      buildPatch={(data) => ({
        notifications: {
          messageEmailOptIn: data.get('messageEmailOptIn') === 'on',
          marketingOptIn: data.get('marketingOptIn') === 'on',
        },
      })}
    >
      {() => (
        <>
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input
              type="checkbox"
              name="messageEmailOptIn"
              defaultChecked={notifications.messageEmailOptIn}
              className="size-5 accent-accent"
            />
            Email me when I get a new message
          </label>
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input
              type="checkbox"
              name="marketingOptIn"
              defaultChecked={notifications.marketingOptIn}
              className="size-5 accent-accent"
            />
            Product news and tips
          </label>
        </>
      )}
    </SectionForm>
  );
}
