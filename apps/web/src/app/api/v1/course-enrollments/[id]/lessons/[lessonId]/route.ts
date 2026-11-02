import { apiHandler } from '@/server/api';
import { lessonDoneRoute } from '@/server/routes/courses';

export const PUT = apiHandler(lessonDoneRoute);
