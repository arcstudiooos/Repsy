import { apiHandler } from '@/server/api';
import { progressReportPdfRoute } from '@/server/routes/progressReports';

export const GET = apiHandler(progressReportPdfRoute);
