import { apiHandler } from '@/server/api';
import { classAttendanceRoute } from '@/server/routes/locationsClasses';

export const PUT = apiHandler(classAttendanceRoute);
