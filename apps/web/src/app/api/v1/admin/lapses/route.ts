import { apiHandler } from '@/server/api';
import { adminLapsePostRoute } from '@/server/routes/lapse';

export const POST = apiHandler(adminLapsePostRoute);
