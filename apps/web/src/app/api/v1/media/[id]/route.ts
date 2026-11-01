import { apiHandler } from '@/server/api';
import { mediaDownloadRoute } from '@/server/routes/media';

export const GET = apiHandler(mediaDownloadRoute);
