import { apiHandler } from '@/server/api';
import { automationRunDeleteRoute } from '@/server/routes/automations';

export const DELETE = apiHandler(automationRunDeleteRoute);
