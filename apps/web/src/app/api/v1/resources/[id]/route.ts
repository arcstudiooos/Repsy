import { apiHandler } from '@/server/api';
import { resourceDeleteRoute } from '@/server/routes/resources';

export const DELETE = apiHandler(resourceDeleteRoute);
