import { apiHandler } from '@/server/api';
import { billingPaymentsPostRoute } from '@/server/routes/billing';

export const POST = apiHandler(billingPaymentsPostRoute);
