import { apiHandler } from '@/server/api';
import { sessionsRevokeAllRoute } from '@/server/routes/sessions';

export const POST = apiHandler(sessionsRevokeAllRoute);
