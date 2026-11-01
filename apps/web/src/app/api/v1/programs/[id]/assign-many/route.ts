import { apiHandler } from '@/server/api';
import { assignManyRoute } from '@/server/routes/assignments';

export const POST = apiHandler(assignManyRoute);
