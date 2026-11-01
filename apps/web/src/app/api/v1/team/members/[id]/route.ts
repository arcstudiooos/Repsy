import { apiHandler } from '@/server/api';
import { teamMemberDeleteRoute, teamMemberPutRoute } from '@/server/routes/team';

export const PUT = apiHandler(teamMemberPutRoute);
export const DELETE = apiHandler(teamMemberDeleteRoute);
