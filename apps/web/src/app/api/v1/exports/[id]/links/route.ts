import { apiHandler } from '@/server/api';
import { exportLinksRoute } from '@/server/routes/exports';

export const POST = apiHandler(exportLinksRoute);
