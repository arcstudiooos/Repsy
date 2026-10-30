import { apiHandler } from '@/server/api';
import { noteDeleteRoute, notePatchRoute } from '@/server/routes/notes';

export const PATCH = apiHandler(notePatchRoute);
export const DELETE = apiHandler(noteDeleteRoute);
