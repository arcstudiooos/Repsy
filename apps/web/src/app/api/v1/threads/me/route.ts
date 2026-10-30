import { apiHandler } from '@/server/api';
import { threadMeRoute } from '@/server/routes/messages';

export const GET = apiHandler(threadMeRoute);
