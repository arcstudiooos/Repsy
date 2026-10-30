import { apiHandler } from '@/server/api';
import { messagesListRoute, messagesPostRoute } from '@/server/routes/messages';

export const GET = apiHandler(messagesListRoute);
export const POST = apiHandler(messagesPostRoute);
