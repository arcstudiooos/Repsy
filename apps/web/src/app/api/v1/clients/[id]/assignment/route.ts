import { apiHandler } from '@/server/api';
import { assignmentGetRoute } from '@/server/routes/assignments';

export const GET = apiHandler(assignmentGetRoute);
