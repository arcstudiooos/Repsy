import { apiHandler } from '@/server/api';
import { clientAssessmentPostRoute } from '@/server/routes/assessments';

export const POST = apiHandler(clientAssessmentPostRoute);
