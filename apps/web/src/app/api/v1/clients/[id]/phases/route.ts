import { apiHandler } from '@/server/api';
import { phasesListRoute, phasesPostRoute } from '@/server/routes/phases';

export const GET = apiHandler(phasesListRoute);
export const POST = apiHandler(phasesPostRoute);
