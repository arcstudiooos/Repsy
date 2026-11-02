import { apiHandler } from '@/server/api';
import { manualPaymentRoute } from '@/server/routes/billing';

export const POST = apiHandler(manualPaymentRoute);
