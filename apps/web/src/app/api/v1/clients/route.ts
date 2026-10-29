import { apiHandler } from '@/server/api';
import { clientsListRoute, clientsPostRoute } from '@/server/routes/clients';

export const GET = apiHandler(clientsListRoute);
export const POST = apiHandler(clientsPostRoute);
