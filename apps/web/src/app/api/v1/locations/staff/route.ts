import { apiHandler } from '@/server/api';
import { staffLocationRoute } from '@/server/routes/locationsClasses';

export const PUT = apiHandler(staffLocationRoute);
