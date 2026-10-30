import { apiHandler } from '@/server/api';
import { adminDeletionsListRoute } from '@/server/routes/privacy';

export const GET = apiHandler(adminDeletionsListRoute);
