import { apiHandler } from '@/server/api';
import { coverDeleteRoute } from '@/server/routes/team';

export const DELETE = apiHandler(coverDeleteRoute);
