import { apiHandler } from '@/server/api';
import { purchaseManageRoute } from '@/server/routes/billing';

export const POST = apiHandler(purchaseManageRoute);
