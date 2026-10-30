import { apiHandler } from '@/server/api';
import { adminGrantDeleteRoute } from '@/server/routes/privacy';

export const DELETE = apiHandler(adminGrantDeleteRoute);
