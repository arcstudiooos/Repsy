'use client';

import { SectionForm } from './form';

/** Message-email and marketing opt-ins (both off by default). Shared by the coach and portal pages. */
export function NotificationsSection({
  notifications,
  coach = false,
}: {
  notifications: {
    messageEmailOptIn: boolean;
    marketingOptIn: boolean;
    digestEmailOptIn?: boolean;
    weeklyBriefOptIn?: boolean;
    workoutReminderOptIn?: boolean;
    checkinReminderOptIn?: boolean;
    habitReminderOptIn?: boolean;
  };
  /** Coaches also get the daily digest choice (PRD H14). */
  coach?: boolean;
}) {
  return (
    <SectionForm
      title="Notifications"
      description="Account emails like verification and password reset are always sent."
      buildPatch={(data) => ({
        notifications: {
          messageEmailOptIn: data.get('messageEmailOptIn') === 'on',
          marketingOptIn: data.get('marketingOptIn') === 'on',
          ...(coach
            ? {
                digestEmailOptIn: data.get('digestEmailOptIn') === 'on',
                weeklyBriefOptIn: data.get('weeklyBriefOptIn') === 'on',
              }
            : {
                workoutReminderOptIn: data.get('workoutReminderOptIn') === 'on',
                checkinReminderOptIn: data.get('checkinReminderOptIn') === 'on',
                habitReminderOptIn: data.get('habitReminderOptIn') === 'on',
              }),
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
          {coach && (
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input
                type="checkbox"
                name="digestEmailOptIn"
                defaultChecked={notifications.digestEmailOptIn ?? false}
                className="size-5 accent-accent"
              />
              Email me a daily digest (new check-ins, unread messages, items to review)
            </label>
          )}
          {coach && (
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input
                type="checkbox"
                name="weeklyBriefOptIn"
                defaultChecked={notifications.weeklyBriefOptIn ?? false}
                className="size-5 accent-accent"
              />
              Email me a Monday brief (last week&apos;s wins, who slipped, what&apos;s due)
            </label>
          )}
          {!coach && (
            <fieldset className="flex flex-col">
              <legend className="mb-1 font-medium">Reminders</legend>
              <p className="mb-1 text-sm text-secondary">
                Never between 21:00 and 07:00, at most three a day, and none while your program is
                paused.
              </p>
              {(
                [
                  [
                    'workoutReminderOptIn',
                    'On workout days at 07:00, and the day before a booked session',
                  ],
                  [
                    'checkinReminderOptIn',
                    "When my check-in is due and I haven't sent it, at 18:00",
                  ],
                  ['habitReminderOptIn', "When I haven't ticked my habits, at 19:00"],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="flex min-h-11 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    name={name}
                    defaultChecked={notifications[name] ?? false}
                    className="size-5 accent-accent"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
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
