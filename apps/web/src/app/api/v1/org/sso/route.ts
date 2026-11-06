import { apiHandler } from '@/server/api';
import { ssoDeleteRoute, ssoGetRoute, ssoPutRoute } from '@/server/routes/sso';

export const GET = apiHandler(ssoGetRoute);
export const PUT = apiHandler(ssoPutRoute);
export const DELETE = apiHandler(ssoDeleteRoute);
