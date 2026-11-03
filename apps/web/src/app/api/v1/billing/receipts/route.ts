import { apiHandler } from '@/server/api';
import { billingReceiptsGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingReceiptsGetRoute);
