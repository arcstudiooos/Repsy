import { apiHandler } from '@/server/api';
import { adminAccountLookupRoute } from '@/server/routes/privacy';

export const GET = apiHandler(adminAccountLookupRoute);
