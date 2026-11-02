import { apiHandler } from '@/server/api';
import { assessmentPhotoDeleteRoute } from '@/server/routes/assessments';

export const DELETE = apiHandler(assessmentPhotoDeleteRoute);
