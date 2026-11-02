import { apiHandler } from '@/server/api';
import { purchasesGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(purchasesGetRoute);
