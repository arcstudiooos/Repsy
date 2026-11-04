import { apiHandler } from '@/server/api';
import { aiDraftsGetRoute, aiDraftsPostRoute } from '@/server/routes/aiDrafts';

export const POST = apiHandler(aiDraftsPostRoute);
export const GET = apiHandler(aiDraftsGetRoute);
