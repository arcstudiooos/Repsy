import { apiHandler } from '@/server/api';
import { assistantMessageRoute } from '@/server/routes/assistant';

export const POST = apiHandler(assistantMessageRoute);
