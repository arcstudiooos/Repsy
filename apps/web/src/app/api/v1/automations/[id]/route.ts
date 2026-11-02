import { apiHandler } from '@/server/api';
import { automationDeleteRoute, automationPutRoute } from '@/server/routes/automations';

export const PUT = apiHandler(automationPutRoute);
export const DELETE = apiHandler(automationDeleteRoute);
