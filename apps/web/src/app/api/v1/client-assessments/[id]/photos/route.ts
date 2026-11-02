import { apiHandler } from '@/server/api';
import { assessmentPhotoPostRoute } from '@/server/routes/assessments';

export const POST = apiHandler(assessmentPhotoPostRoute);
