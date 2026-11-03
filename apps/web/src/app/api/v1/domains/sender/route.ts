import { apiHandler } from '@/server/api';
import { domainSenderRoute } from '@/server/routes/domains';

export const POST = apiHandler(domainSenderRoute);
