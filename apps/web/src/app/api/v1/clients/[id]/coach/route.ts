import { apiHandler } from '@/server/api';
import { clientCoachPutRoute } from '@/server/routes/clients';

export const PUT = apiHandler(clientCoachPutRoute);
