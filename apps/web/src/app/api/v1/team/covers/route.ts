import { apiHandler } from '@/server/api';
import { coverPostRoute } from '@/server/routes/team';

export const POST = apiHandler(coverPostRoute);
