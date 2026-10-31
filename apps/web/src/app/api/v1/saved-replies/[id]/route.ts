import { apiHandler } from '@/server/api';
import { savedReplyDeleteRoute } from '@/server/routes/messagingTools';

export const DELETE = apiHandler(savedReplyDeleteRoute);
