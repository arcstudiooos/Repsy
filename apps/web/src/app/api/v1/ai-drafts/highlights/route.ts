import { apiHandler } from '@/server/api';
import { aiDraftHighlightsRoute } from '@/server/routes/aiDrafts';

export const GET = apiHandler(aiDraftHighlightsRoute);
