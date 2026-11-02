import { apiHandler } from '@/server/api';
import { automationsListRoute, automationsPostRoute } from '@/server/routes/automations';

export const GET = apiHandler(automationsListRoute);
export const POST = apiHandler(automationsPostRoute);
