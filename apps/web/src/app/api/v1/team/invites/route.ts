import { apiHandler } from '@/server/api';
import { teamInviteRoute } from '@/server/routes/team';

export const POST = apiHandler(teamInviteRoute);
