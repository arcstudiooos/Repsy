import { apiHandler } from '@/server/api';
import { purchaseCancelRoute } from '@/server/routes/billing';

export const POST = apiHandler(purchaseCancelRoute);
