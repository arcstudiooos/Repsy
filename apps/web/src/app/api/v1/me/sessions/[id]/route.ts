import { apiHandler } from '@/server/api';
import { deviceSessionRevokeRoute } from '@/server/routes/sessions';

export const DELETE = apiHandler(deviceSessionRevokeRoute);
