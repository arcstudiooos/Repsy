import { apiHandler } from '@/server/api';
import { clientHistoryRoute } from '@/server/routes/clients';

export const GET = apiHandler(clientHistoryRoute);
