import { apiHandler } from '@/server/api';
import { timelineRoute } from '@/server/routes/notes';

export const GET = apiHandler(timelineRoute);
