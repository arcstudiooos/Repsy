import { apiHandler } from '@/server/api';
import { automationStartRoute } from '@/server/routes/automations';

export const POST = apiHandler(automationStartRoute);
