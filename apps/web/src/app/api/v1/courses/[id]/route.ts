import { apiHandler } from '@/server/api';
import { courseDeleteRoute, coursePutRoute } from '@/server/routes/courses';

export const PUT = apiHandler(coursePutRoute);
export const DELETE = apiHandler(courseDeleteRoute);
