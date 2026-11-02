import { apiHandler } from '@/server/api';
import { paymentVoidRoute } from '@/server/routes/billing';

export const POST = apiHandler(paymentVoidRoute);
