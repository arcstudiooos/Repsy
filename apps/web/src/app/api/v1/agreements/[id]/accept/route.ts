import { apiHandler } from '@/server/api';
import { agreementAcceptRoute } from '@/server/routes/agreements';

export const POST = apiHandler(agreementAcceptRoute);
