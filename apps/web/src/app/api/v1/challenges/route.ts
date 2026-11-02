import { apiHandler } from '@/server/api';
import { challengesPostRoute } from '@/server/routes/challenges';

export const POST = apiHandler(challengesPostRoute);
