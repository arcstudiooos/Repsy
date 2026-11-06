import { apiHandler } from '@/server/api';
import { classesListRoute, classesPostRoute } from '@/server/routes/locationsClasses';

export const GET = apiHandler(classesListRoute);
export const POST = apiHandler(classesPostRoute);
