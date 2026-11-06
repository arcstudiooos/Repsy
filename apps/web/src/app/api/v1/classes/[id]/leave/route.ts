import { apiHandler } from '@/server/api';
import { classLeaveRoute } from '@/server/routes/locationsClasses';

export const POST = apiHandler(classLeaveRoute);
