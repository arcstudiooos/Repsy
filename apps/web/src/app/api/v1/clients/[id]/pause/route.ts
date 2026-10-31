import { apiHandler } from '@/server/api';
import { clientPausePatchRoute, clientPausePostRoute } from '@/server/routes/clients';

export const POST = apiHandler(clientPausePostRoute);
export const PATCH = apiHandler(clientPausePatchRoute);
