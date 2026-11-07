import { apiHandler } from '@/server/api';
import { assistantActionCancelRoute } from '@/server/routes/assistant';

export const POST = apiHandler(assistantActionCancelRoute);
