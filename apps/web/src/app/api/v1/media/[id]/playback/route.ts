import { apiHandler } from '@/server/api';
import { mediaPlaybackRoute } from '@/server/routes/media';

export const GET = apiHandler(mediaPlaybackRoute);
