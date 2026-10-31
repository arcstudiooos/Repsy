import { apiHandler } from '@/server/api';
import { goalsListRoute, goalsPostRoute } from '@/server/routes/goals';

export const GET = apiHandler(goalsListRoute);
export const POST = apiHandler(goalsPostRoute);
