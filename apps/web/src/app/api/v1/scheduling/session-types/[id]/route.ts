import { apiHandler } from '@/server/api';
import { sessionTypePutRoute } from '@/server/routes/scheduling';

export const PUT = apiHandler(sessionTypePutRoute);
