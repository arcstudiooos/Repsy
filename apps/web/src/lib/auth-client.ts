'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

/** Same-origin: no base URL needed, so nothing about the domain is hardcoded. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
