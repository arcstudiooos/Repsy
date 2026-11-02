import { apiHandler } from '@/server/api';
import { billingConnectCallbackRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingConnectCallbackRoute);
