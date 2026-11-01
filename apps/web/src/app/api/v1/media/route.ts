import { apiHandler } from '@/server/api';
import { mediaUploadRoute } from '@/server/routes/media';

export const POST = apiHandler(mediaUploadRoute);
