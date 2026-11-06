import { apiHandler } from '@/server/api';
import { classRosterRoute } from '@/server/routes/locationsClasses';

export const GET = apiHandler(classRosterRoute);
