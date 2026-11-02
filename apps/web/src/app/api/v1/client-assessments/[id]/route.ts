import { apiHandler } from '@/server/api';
import { clientAssessmentDeleteRoute } from '@/server/routes/assessments';

export const DELETE = apiHandler(clientAssessmentDeleteRoute);
