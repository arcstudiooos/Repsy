import { apiHandler } from '@/server/api';
import { clientGetRoute, clientPatchRoute } from '@/server/routes/clients';

export const GET = apiHandler(clientGetRoute);
export const PATCH = apiHandler(clientPatchRoute);
