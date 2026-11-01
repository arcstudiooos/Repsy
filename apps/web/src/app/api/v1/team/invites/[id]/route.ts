import { apiHandler } from '@/server/api';
import { teamInviteDeleteRoute } from '@/server/routes/team';

export const DELETE = apiHandler(teamInviteDeleteRoute);
