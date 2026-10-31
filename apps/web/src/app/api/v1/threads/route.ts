import { apiHandler } from '@/server/api';
import { threadsListRoute } from '@/server/routes/messages';

export const GET = apiHandler(threadsListRoute);
