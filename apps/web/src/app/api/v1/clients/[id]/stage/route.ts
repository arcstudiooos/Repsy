import { apiHandler } from '@/server/api';
import { clientStagePutRoute } from '@/server/routes/clients';

export const PUT = apiHandler(clientStagePutRoute);
