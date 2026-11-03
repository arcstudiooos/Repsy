import { apiHandler } from '@/server/api';
import { domainVerifyRoute } from '@/server/routes/domains';

export const POST = apiHandler(domainVerifyRoute);
