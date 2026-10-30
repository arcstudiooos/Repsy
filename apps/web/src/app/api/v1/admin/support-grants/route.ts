import { apiHandler } from '@/server/api';
import { adminGrantPostRoute, adminGrantsListRoute } from '@/server/routes/privacy';

export const GET = apiHandler(adminGrantsListRoute);
export const POST = apiHandler(adminGrantPostRoute);
