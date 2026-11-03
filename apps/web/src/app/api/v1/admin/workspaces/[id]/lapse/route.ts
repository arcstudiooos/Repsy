import { apiHandler } from '@/server/api';
import { adminWorkspaceLapseRoute } from '@/server/routes/privacy';

export const POST = apiHandler(adminWorkspaceLapseRoute);
