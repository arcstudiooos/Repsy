import { apiHandler } from '@/server/api';
import { billingCheckoutPostRoute } from '@/server/routes/billing';

export const POST = apiHandler(billingCheckoutPostRoute);
