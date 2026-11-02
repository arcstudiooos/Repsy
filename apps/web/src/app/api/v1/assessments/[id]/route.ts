import { apiHandler } from '@/server/api';
import { assessmentDeleteRoute, assessmentPutRoute } from '@/server/routes/assessments';

export const PUT = apiHandler(assessmentPutRoute);
export const DELETE = apiHandler(assessmentDeleteRoute);
