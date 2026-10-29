import { apiHandler } from '@/server/api';
import { inviteDeleteRoute, invitePostRoute } from '@/server/routes/invites';

export const POST = apiHandler(invitePostRoute);
export const DELETE = apiHandler(inviteDeleteRoute);
