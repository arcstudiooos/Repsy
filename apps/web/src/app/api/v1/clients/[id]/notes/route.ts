import { apiHandler } from '@/server/api';
import { notesListRoute, notesPostRoute } from '@/server/routes/notes';

export const GET = apiHandler(notesListRoute);
export const POST = apiHandler(notesPostRoute);
