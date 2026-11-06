import { apiHandler } from '@/server/api';
import { locationPatchRoute } from '@/server/routes/locationsClasses';

export const PATCH = apiHandler(locationPatchRoute);
