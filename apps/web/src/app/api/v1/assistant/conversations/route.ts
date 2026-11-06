import { apiHandler } from '@/server/api';
import { assistantConversationsRoute } from '@/server/routes/assistant';

export const GET = apiHandler(assistantConversationsRoute);
