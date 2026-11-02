import { apiHandler } from '@/server/api';
import { assessmentsPostRoute } from '@/server/routes/assessments';

export const POST = apiHandler(assessmentsPostRoute);
