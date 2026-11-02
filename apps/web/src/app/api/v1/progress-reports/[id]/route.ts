import { apiHandler } from '@/server/api';
import { progressReportDeleteRoute } from '@/server/routes/progressReports';

export const DELETE = apiHandler(progressReportDeleteRoute);
