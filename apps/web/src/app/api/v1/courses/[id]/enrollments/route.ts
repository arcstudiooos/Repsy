import { apiHandler } from '@/server/api';
import { courseEnrollRoute } from '@/server/routes/courses';

export const POST = apiHandler(courseEnrollRoute);
