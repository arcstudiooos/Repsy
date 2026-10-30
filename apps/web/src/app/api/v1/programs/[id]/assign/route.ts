import { apiHandler } from '@/server/api';
import { assignPostRoute } from '@/server/routes/assignments';

export const POST = apiHandler(assignPostRoute);
