import { apiHandler } from '@/server/api';
import { deviceSessionsRoute } from '@/server/routes/sessions';

export const GET = apiHandler(deviceSessionsRoute);
