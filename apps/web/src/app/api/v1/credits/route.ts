import { apiHandler } from '@/server/api';
import { creditsGetRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(creditsGetRoute);
