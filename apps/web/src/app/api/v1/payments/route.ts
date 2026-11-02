import { apiHandler } from '@/server/api';
import { paymentsGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(paymentsGetRoute);
