import { apiHandler } from '@/server/api';
import { billingDisconnectRoute } from '@/server/routes/billing';

export const DELETE = apiHandler(billingDisconnectRoute);
