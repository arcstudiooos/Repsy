import { apiHandler } from '@/server/api';
import { billingConnectStartRoute, billingConnectFakeRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingConnectStartRoute);
export const POST = apiHandler(billingConnectFakeRoute);
