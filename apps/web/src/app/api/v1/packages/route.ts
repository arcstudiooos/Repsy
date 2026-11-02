import { apiHandler } from '@/server/api';
import { packagesGetRoute, packagesPostRoute } from '@/server/routes/billing';

export const GET = apiHandler(packagesGetRoute);
export const POST = apiHandler(packagesPostRoute);
