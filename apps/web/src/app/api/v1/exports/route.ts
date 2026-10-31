import { apiHandler } from '@/server/api';
import { exportsListRoute, exportsPostRoute } from '@/server/routes/exports';

export const GET = apiHandler(exportsListRoute);
export const POST = apiHandler(exportsPostRoute);
