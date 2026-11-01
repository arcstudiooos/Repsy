import { apiHandler } from '@/server/api';
import { teamGetRoute } from '@/server/routes/team';

export const GET = apiHandler(teamGetRoute);
