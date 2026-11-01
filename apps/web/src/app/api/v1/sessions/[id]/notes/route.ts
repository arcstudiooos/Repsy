import { apiHandler } from '@/server/api';
import { sessionNoteRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionNoteRoute);
