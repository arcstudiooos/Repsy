import { apiHandler } from '@/server/api';
import { groupCommentRoute } from '@/server/routes/groups';

export const POST = apiHandler(groupCommentRoute);
