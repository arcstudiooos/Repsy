import { apiHandler } from '@/server/api';
import { aiProgramFromTextRoute } from '@/server/routes/ai';

export const POST = apiHandler(aiProgramFromTextRoute);
