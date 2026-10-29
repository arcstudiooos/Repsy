'use client';

import { createAuthClient } from 'better-auth/react';

/** Same-origin: no base URL needed, so nothing about the domain is hardcoded. */
export const authClient = createAuthClient();
