import { apiHandler } from '@/server/api';
import { automationDecideRoute } from '@/server/routes/automations';

export const POST = apiHandler(automationDecideRoute);
