import { apiHandler } from '@/server/api';
import { setupChecklistPutRoute } from '@/server/routes/settings';

export const PUT = apiHandler(setupChecklistPutRoute);
