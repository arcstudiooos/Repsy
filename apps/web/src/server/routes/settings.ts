import { z } from 'zod';
import { appendAudit } from '@kinetic/db';
import {
  getBranding,
  getSettings,
  setSetupChecklistHidden,
  updateBranding,
  updateSettings,
  type SettingsView,
} from '@kinetic/core';
import type { RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
// Ranges and permissions are enforced in core; this only fixes the shapes.
const units = z.enum(['kg', 'lb']);
const patchSchema = z.object({
  profile: z
    .object({
      bio: z.string().max(5000).nullable().optional(),
      specialties: z.array(z.string().max(200)).max(100).optional(),
      units: units.optional(),
    })
    .optional(),
  org: z
    .object({
      name: z.string().max(500).optional(),
      timezone: z.string().max(100).optional(),
      // null (a blank form field) reaches core, which rejects it on `org.graceHours`.
      graceHours: z.number().nullable().optional(),
    })
    .optional(),
  notifications: z
    .object({
      messageEmailOptIn: z.boolean().optional(),
      digestEmailOptIn: z.boolean().optional(),
      weeklyBriefOptIn: z.boolean().optional(),
      marketingOptIn: z.boolean().optional(),
      workoutReminderOptIn: z.boolean().optional(),
      checkinReminderOptIn: z.boolean().optional(),
      habitReminderOptIn: z.boolean().optional(),
    })
    .optional(),
  client: z
    .object({ timezone: z.string().max(100).optional(), preferredUnits: units.optional() })
    .optional(),
});

/** The caller's settings; shape depends on role. Creates their profile/preference rows on first read. */
export const settingsGetRoute: RouteDef<undefined, true> = {
  handler: ({ actor, tenant }): Promise<SettingsView> => tenant((tx) => getSettings(tx, actor)),
};

export const settingsPatchRoute: RouteDef<typeof patchSchema, true> = {
  input: patchSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant(async (tx) => {
      const fields = await updateSettings(tx, actor, input);
      if (fields.length > 0) {
        await appendAudit(tx, {
          orgId: actor.orgId,
          actorId: actor.userId,
          objectType: 'settings',
          objectId: actor.userId,
          action: 'settings.updated',
          // Field names only, never values.
          metadata: { fields: fields.join(',') },
          requestId,
        });
      }
      return getSettings(tx, actor);
    }),
};

const setupSchema = z.object({ hidden: z.boolean() });

/** `PUT /api/v1/settings/setup-checklist`: hide or show the dashboard setup checklist for this coach (PRD A5). */
export const setupChecklistPutRoute: RouteDef<typeof setupSchema, true> = {
  can: 'org:read',
  input: setupSchema,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => setSetupChecklistHidden(tx, actor, input.hidden)),
};

/** `GET /api/v1/org/branding` (PRD A6): any member. */
export const brandingGetRoute: RouteDef<undefined, true> = {
  handler: ({ tenant }) => tenant((tx) => getBranding(tx)),
};

const brandingSchema = z.object({
  accent: z.string().max(20).nullable().optional(),
  logoUrl: z.string().max(2000).nullable().optional(),
});

/** `PUT /api/v1/org/branding`: owner only. */
export const brandingPutRoute: RouteDef<typeof brandingSchema, true> = {
  can: 'settings:org:update',
  input: brandingSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => updateBranding(tx, actor, input, { requestId })),
};
