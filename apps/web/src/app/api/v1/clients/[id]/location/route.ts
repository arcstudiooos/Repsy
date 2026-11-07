import { apiHandler } from '@/server/api';
import { clientLocationRoute } from '@/server/routes/locationsClasses';

export const PUT = apiHandler(clientLocationRoute);
