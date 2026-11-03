import { apiHandler } from '@/server/api';
import { aiProgramFromTemplateRoute } from '@/server/routes/ai';

export const POST = apiHandler(aiProgramFromTemplateRoute);
