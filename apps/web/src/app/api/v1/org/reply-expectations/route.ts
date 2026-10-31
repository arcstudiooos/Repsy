import { apiHandler } from '@/server/api';
import {
  replyExpectationsGetRoute,
  replyExpectationsPutRoute,
} from '@/server/routes/messagingTools';

export const GET = apiHandler(replyExpectationsGetRoute);
export const PUT = apiHandler(replyExpectationsPutRoute);
