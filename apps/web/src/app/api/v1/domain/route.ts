import { apiHandler } from '@/server/api';
import { domainDeleteRoute, domainGetRoute, domainPostRoute } from '@/server/routes/domains';

export const GET = apiHandler(domainGetRoute);
export const POST = apiHandler(domainPostRoute);
export const DELETE = apiHandler(domainDeleteRoute);
