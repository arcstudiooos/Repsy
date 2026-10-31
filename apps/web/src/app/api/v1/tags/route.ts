import { apiHandler } from '@/server/api';
import { tagsListRoute, tagsPostRoute } from '@/server/routes/tags';

export const GET = apiHandler(tagsListRoute);
export const POST = apiHandler(tagsPostRoute);
