import { apiHandler } from '@/server/api';
import { aiCheckinHighlightsRoute } from '@/server/routes/ai';

export const POST = apiHandler(aiCheckinHighlightsRoute);
