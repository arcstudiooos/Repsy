import { apiHandler } from '@/server/api';
import { exportFileRoute } from '@/server/routes/exports';

export const GET = apiHandler(exportFileRoute);
