import { apiHandler } from '@/server/api';
import { receiptGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(receiptGetRoute);
