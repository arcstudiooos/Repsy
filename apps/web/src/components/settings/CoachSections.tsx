'use client';

import { Input } from '@/components/ui/input';
import { Field, fieldAria, Select, SectionForm, useTimezones } from './form';
import { graceHoursValue } from './graceHours';

const textarea =
  'block w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink aria-invalid:border-danger';

export function ProfileSection({
  profile,
}: {
  profile: { bio: string | null; specialties: string[]; units: 'kg' | 'lb' };
}) {
  return (
    <SectionForm
      title="Profile"
      description="Shown to your clients."
      buildPatch={(data) => ({
        profile: {
          bio: String(data.get('bio') ?? ''),
          specialties: String(data.get('specialties') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          units: data.get('units'),
        },
      })}
    >
      {(errors, uid) => {
        const bio = `${uid}-bio`;
        const spec = `${uid}-spec`;
        const units = `${uid}-units`;
        return (
          <>
            <Field id={bio} label="Bio" error={errors['profile.bio']?.[0]}>
              <textarea
                id={bio}
                name="bio"
                rows={4}
                maxLength={1000}
                defaultValue={profile.bio ?? ''}
                className={textarea}
                {...fieldAria(bio, errors['profile.bio']?.[0])}
              />
            </Field>
            <Field
              id={spec}
              label="Specialties"
              hint="Separate with commas. Up to 10, 40 characters each."
              error={errors['profile.specialties']?.[0]}
            >
              <Input
                id={spec}
                name="specialties"
                defaultValue={profile.specialties.join(', ')}
                {...fieldAria(spec, errors['profile.specialties']?.[0], true)}
              />
            </Field>
            <Field id={units} label="Units" error={errors['profile.units']?.[0]}>
              <Select
                id={units}
                name="units"
                defaultValue={profile.units}
                {...fieldAria(units, errors['profile.units']?.[0])}
              >
                <option value="kg">Kilograms (kg)</option>
                <option value="lb">Pounds (lb)</option>
              </Select>
            </Field>
          </>
        );
      }}
    </SectionForm>
  );
}

export function OrganizationSection({
  org,
  canEdit,
}: {
  org: { name: string; timezone: string };
  canEdit: boolean;
}) {
  const zones = useTimezones();
  return (
    <SectionForm
      title="Organization"
      description="Your coaching business."
      readOnlyNote={canEdit ? undefined : 'Only the owner can change organization details.'}
      buildPatch={(data) => ({
        org: { name: String(data.get('name') ?? ''), timezone: String(data.get('timezone') ?? '') },
      })}
    >
      {(errors, uid) => {
        const name = `${uid}-name`;
        const tz = `${uid}-tz`;
        return (
          <>
            <Field id={name} label="Organization name" error={errors['org.name']?.[0]}>
              <Input
                id={name}
                name="name"
                required
                maxLength={120}
                defaultValue={org.name}
                disabled={!canEdit}
                {...fieldAria(name, errors['org.name']?.[0])}
              />
            </Field>
            <Field id={tz} label="Time zone" error={errors['org.timezone']?.[0]}>
              <Input
                id={tz}
                name="timezone"
                list={`${tz}-list`}
                required
                defaultValue={org.timezone}
                disabled={!canEdit}
                autoComplete="off"
                {...fieldAria(tz, errors['org.timezone']?.[0])}
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

export function TrainingDefaultsSection({
  graceHours,
  canEdit,
}: {
  graceHours: number;
  canEdit: boolean;
}) {
  return (
    <SectionForm
      title="Training defaults"
      description="Applies across your organization."
      readOnlyNote={canEdit ? undefined : 'Only the owner can change training defaults.'}
      buildPatch={(data) => ({ org: { graceHours: graceHoursValue(data.get('graceHours')) } })}
    >
      {(errors, uid) => {
        const id = `${uid}-grace`;
        return (
          <Field
            id={id}
            label="Grace period (hours)"
            hint="How long after a scheduled workout or check-in a client can still complete it. 0 to 72 hours."
            error={errors['org.graceHours']?.[0]}
          >
            <Input
              id={id}
              name="graceHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={72}
              step={1}
              required
              defaultValue={graceHours}
              disabled={!canEdit}
              {...fieldAria(id, errors['org.graceHours']?.[0], true)}
            />
          </Field>
        );
      }}
    </SectionForm>
  );
}
