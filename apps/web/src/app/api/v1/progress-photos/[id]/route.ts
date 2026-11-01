import { apiHandler } from '@/server/api';
import { progressPhotoDeleteRoute } from '@/server/routes/media';

export const DELETE = apiHandler(progressPhotoDeleteRoute);
