import { apiHandler } from '@/server/api';
import { purchaseLiftGateRoute } from '@/server/routes/billing';

export const POST = apiHandler(purchaseLiftGateRoute);
