import { auth } from '@/lib/auth';
import { createAuthHandlers } from '@/lib/auth-handler';

export const { GET, POST } = createAuthHandlers(auth);
