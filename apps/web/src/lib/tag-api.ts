/** Browser-side calls to the client tags API (same-origin, so the CSRF Origin check passes). */
import type { TagView } from '@repsy/core';
import { call } from './checkin-api';

export const createTagApi = (name: string, color: string) =>
  call<TagView>('POST', '/api/v1/tags', { name, color });

export const setClientTagsApi = (clientId: string, tagIds: string[]) =>
  call<TagView[]>('PUT', `/api/v1/clients/${encodeURIComponent(clientId)}/tags`, { tagIds });
