import { apiHandler } from '@/server/api';
import { savedRepliesListRoute, savedRepliesPostRoute } from '@/server/routes/messagingTools';

export const GET = apiHandler(savedRepliesListRoute);
export const POST = apiHandler(savedRepliesPostRoute);
