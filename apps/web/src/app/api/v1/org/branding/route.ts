import { apiHandler } from '@/server/api';
import { brandingGetRoute, brandingPutRoute } from '@/server/routes/settings';

export const GET = apiHandler(brandingGetRoute);
export const PUT = apiHandler(brandingPutRoute);
