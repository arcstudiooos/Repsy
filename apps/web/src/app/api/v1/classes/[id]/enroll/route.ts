import { apiHandler } from '@/server/api';
import { classEnrollRoute } from '@/server/routes/locationsClasses';

export const POST = apiHandler(classEnrollRoute);
