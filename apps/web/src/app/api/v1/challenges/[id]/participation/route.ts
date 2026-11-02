import { apiHandler } from '@/server/api';
import { challengeParticipationRoute } from '@/server/routes/challenges';

export const PUT = apiHandler(challengeParticipationRoute);
