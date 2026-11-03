import { apiHandler } from '@/server/api';
import { availabilityPutRoute } from '@/server/routes/scheduling';

export const PUT = apiHandler(availabilityPutRoute);
