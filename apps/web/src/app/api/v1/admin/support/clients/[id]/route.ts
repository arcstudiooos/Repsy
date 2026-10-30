import { apiHandler } from '@/server/api';
import { adminSupportClientRoute } from '@/server/routes/privacy';

export const GET = apiHandler(adminSupportClientRoute);
