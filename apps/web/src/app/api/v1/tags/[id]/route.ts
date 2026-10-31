import { apiHandler } from '@/server/api';
import { tagDeleteRoute } from '@/server/routes/tags';

export const DELETE = apiHandler(tagDeleteRoute);
