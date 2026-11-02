import { apiHandler } from '@/server/api';
import { paymentRefundRoute } from '@/server/routes/billing';

export const POST = apiHandler(paymentRefundRoute);
