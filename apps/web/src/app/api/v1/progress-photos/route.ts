import { apiHandler } from '@/server/api';
import { progressPhotoPostRoute, progressPhotosListRoute } from '@/server/routes/media';

export const GET = apiHandler(progressPhotosListRoute);
export const POST = apiHandler(progressPhotoPostRoute);
