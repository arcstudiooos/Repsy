'use client';

import { Input } from '@/components/ui/input';
import { Field, fieldAria, Select, SectionForm, useTimezones } from './form';

/** A client's own units and time zone (writes their Client row). */
export function ClientPreferencesSection({
  client,
}: {
  client: { timezone: string; preferredUnits: 'kg' | 'lb' };
}) {
  const zones = useTimezones();
  return (
    <SectionForm
      title="Units and time zone"
      description="Used for your workouts and reminders."
      buildPatch={(data) => ({
        client: {
          preferredUnits: data.get('preferredUnits'),
          timezone: String(data.get('timezone') ?? ''),
        },
      })}
    >
      {(errors, uid) => {
        const units = `${uid}-units`;
        const tz = `${uid}-tz`;
        return (
          <>
            <Field id={units} label="Units" error={errors['client.preferredUnits']?.[0]}>
              <Select
                id={units}
                name="preferredUnits"
                defaultValue={client.preferredUnits}
                {...fieldAria(units, errors['client.preferredUnits']?.[0])}
              >
                <option value="kg">Kilograms (kg)</option>
                <option value="lb">Pounds (lb)</option>
              </Select>
            </Field>
            <Field id={tz} label="Time zone" error={errors['client.timezone']?.[0]}>
              <Input
                id={tz}
                name="timezone"
                list={`${tz}-list`}
                required
                defaultValue={client.timezone}
                autoComplete="off"
                {...fieldAria(tz, errors['client.timezone']?.[0])}
              />
              <datalist id={`${tz}-list`}>
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
          </>
        );
      }}
    </SectionForm>
  );
}
