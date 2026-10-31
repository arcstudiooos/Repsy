import { apiHandler } from '@/server/api';
import { reviewRulesGetRoute, reviewRulesPutRoute } from '@/server/routes/messagingTools';

export const GET = apiHandler(reviewRulesGetRoute);
export const PUT = apiHandler(reviewRulesPutRoute);
