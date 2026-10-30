import { apiHandler } from '@/server/api';
import { adminPilotCodesListRoute, adminPilotCodesPostRoute } from '@/server/routes/privacy';

export const GET = apiHandler(adminPilotCodesListRoute);
export const POST = apiHandler(adminPilotCodesPostRoute);
