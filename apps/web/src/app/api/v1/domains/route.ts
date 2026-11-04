import { apiHandler } from '@/server/api';
import { domainsListRoute, domainsPostRoute } from '@/server/routes/domains';

export const GET = apiHandler(domainsListRoute);
export const POST = apiHandler(domainsPostRoute);
