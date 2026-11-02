import { apiHandler } from '@/server/api';
import { coursesPostRoute } from '@/server/routes/courses';

export const POST = apiHandler(coursesPostRoute);
