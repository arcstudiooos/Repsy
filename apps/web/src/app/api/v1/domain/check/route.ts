import { apiHandler } from '@/server/api';
import { domainCheckRoute } from '@/server/routes/domains';

export const POST = apiHandler(domainCheckRoute);
