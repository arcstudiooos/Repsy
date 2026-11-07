import { apiHandler } from '@/server/api';
import { classPatchRoute } from '@/server/routes/locationsClasses';

export const PATCH = apiHandler(classPatchRoute);
