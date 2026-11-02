import { apiHandler } from '@/server/api';
import { enrollmentDeleteRoute } from '@/server/routes/courses';

export const DELETE = apiHandler(enrollmentDeleteRoute);
