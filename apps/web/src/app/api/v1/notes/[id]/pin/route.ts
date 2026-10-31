import { apiHandler } from '@/server/api';
import { notePinRoute } from '@/server/routes/context';

export const PUT = apiHandler(notePinRoute);
