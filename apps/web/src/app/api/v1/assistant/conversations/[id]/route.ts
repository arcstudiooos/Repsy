import { apiHandler } from '@/server/api';
import {
  assistantConversationDeleteRoute,
  assistantConversationGetRoute,
} from '@/server/routes/assistant';

export const GET = apiHandler(assistantConversationGetRoute);
export const DELETE = apiHandler(assistantConversationDeleteRoute);
