import { apiHandler } from '@/server/api';
import { progressReportPostRoute } from '@/server/routes/progressReports';

export const POST = apiHandler(progressReportPostRoute);
