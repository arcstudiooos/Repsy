import { join } from 'node:path';

export interface E2EState {
  adminUrl: string;
  appUrl: string;
  emailDir: string;
}

/** Playwright and the stack launcher both run with cwd = apps/web. */
export const STATE_FILE = join(process.cwd(), 'e2e', '.state.json');
