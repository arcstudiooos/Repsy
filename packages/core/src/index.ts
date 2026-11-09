export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
export {
  EVENT_PROPERTIES,
  assertAllowedEvent,
  hashId,
  noopAnalytics,
  AnalyticsPropertyError,
  type AnalyticsEvent,
  type AnalyticsPort,
  type EventName,
  type EventValue,
} from './ports/analytics';
export {
  enqueueEmail,
  enqueuePlatformEmail,
  type EnqueueEmailInput,
  type EmailRecipient,
} from './outbox';
export { DomainError, httpStatusFor, ERROR_STATUS, type ErrorCode } from './errors';
export {
  ROLES,
  COACH_ROLES,
  isCoachRole,
  isManager,
  MANAGER_ROLES,
  STAFF_ROLES,
  TRAINER_ROLES,
  highestRole,
  type ActorContext,
  type MembershipRef,
  type Role,
} from './authz/actor';
export { can, assertCan, type Action } from './authz/policies';
export { enforceAttemptLimit, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS } from './identity/rateLimit';
export {
  signupCoach,
  TRIAL_CLIENT_LIMIT,
  TRIAL_DAYS,
  type SignupCoachInput,
} from './identity/signupCoach';
export { generatePilotCode, hashPilotCode, normalizePilotCode } from './identity/pilotCode';
export { createLogger, logger, type Logger } from './log';
export { UUID, isUuid } from './uuid';
export { encodeCursor, decodeCursor, PAGE_SIZE, type CursorRow } from './pagination';
export {
  createClient,
  listClients,
  getClient,
  updateClient,
  toClientView,
  escapeLike,
  cleanGoals,
  countActiveClients,
  nextClientStatus,
  GOALS_MAX,
  type ClientView,
  type ClientStatus,
} from './clients/clients';
export {
  applyPause,
  updatePause,
  resumeNow,
  endDuePause,
  openPauseOf,
  MAX_PAUSE_DAYS,
  type PauseView,
} from './clients/pause';
export {
  issueInvite,
  revokeInvite,
  acceptInvite,
  classifyInvite,
  inviteFailureMessage,
  type InviteFailure,
  summarizeInvites,
  INVITE_TTL_MS,
  type InviteClass,
  type InviteStatus,
  type AcceptInviteInput,
} from './invites/invites';
export { newInviteToken, hashInviteToken } from './invites/token';
export { PRIVACY_NOTICE_VERSION, PRIVACY_NOTICE_TEXT } from './privacy';
export { canonicalTimezone, isIanaTimezone, todayInZone, zonedTimeToUtc } from './timezone';
export {
  getSettings,
  updateSettings,
  type SettingsView,
  type SettingsPatch,
} from './settings/settings';
export {
  createExercise,
  searchExercises,
  EXERCISE_PAGE_SIZE,
  MUSCLE_GROUPS,
  EQUIPMENT,
  MOVEMENT_TYPES,
  TRACKING_TYPES,
  DIFFICULTIES,
  type Difficulty,
  type ExerciseView,
  type TrackingType,
  type CreateExerciseInput,
  type SearchExercisesQuery,
} from './exercises/exercises';
export {
  commitProgramVersion,
  type CommitInput,
  type WeekInput,
  type DayInput,
  type ExerciseInput,
} from './programs/commit';
export {
  createProgram,
  renameProgram,
  setProgramHouse,
  listPrograms,
  getProgram,
  type ProgramDetail,
  type ProgramSummary,
} from './programs/read';
export {
  targetSchema,
  setTargetSchema,
  type SetTarget,
  type WorkoutTargets,
} from './programs/targets';
export {
  WORKOUT_SECTIONS,
  SECTION_LABEL,
  sectionStart,
  type WorkoutSection,
} from './programs/sections';
export {
  BLOCK_FORMATS,
  BLOCK_FORMAT_LABEL,
  blockLayout,
  describeBlock,
  type BlockFormat,
  type BlockSpec,
} from './programs/blocks';
export { toDisplay, fromDisplay, type Units } from './units';
export {
  scheduleSlots,
  localDayBounds,
  localTimeOn,
  ScheduleInputError,
} from './schedule/scheduleSlots';
export {
  getCheckinTemplate,
  updateCheckinTemplate,
  setCheckinWeekday,
  listCheckins,
  getCheckin,
  saveCheckinDraft,
  submitCheckin,
  weekActivityBefore,
  issueDueCheckins,
  ISSUE_HOUR,
  type CheckinTemplateView,
  type CheckinView,
  type CheckinStatus,
  type WeekActivity,
  type CheckinSubmittedHook,
  markCheckinReviewed,
  checkinStreak,
  listCheckinsAwaitingReview,
  type CheckinAwaitingReview,
} from './checkins/checkins';
export {
  evaluateRules,
  deriveSessionStates,
  resolveStaleMissedFlags,
  onCheckinSubmittedRules,
  raiseFlag,
  RULE_TEXT,
  AUTO_RESOLVED,
  SWEEP_RULES,
  type RuleKey,
  type Rule,
  type FlagUpsert,
} from './review/rules';
export {
  listFlags,
  countOpenFlags,
  countRecentMissed,
  updateFlag,
  createFollowup,
  SNOOZE_DAYS,
  REASON_MAX,
  FOLLOWUP_TITLE_MAX,
  type FlagView,
  type FlagState,
  type FlagFilter,
  type FlagAction,
} from './review/flags';
export {
  requestDeletion,
  deletionStatusFor,
  eraseClientData,
  recordErasureFailure,
  ERASURE_TIMEOUT_MS,
  type DeletionRequestView,
  type DeletionStatus,
  type ErasureResult,
} from './privacy/deletion';
export {
  assertPlatformAdmin,
  listPilotCodes,
  createPilotCode,
  lookupAccount,
  listDeletionRequests,
  decideDeletion,
  grantSupportAccess,
  revokeSupportAccess,
  listMyGrants,
  readClientForSupport,
  SUPPORT_GRANT_MS,
  type PlatformAdmin,
  type PilotCodeView,
  type AccountView,
  type DeletionQueueItem,
  type SupportGrantView,
  type SupportClientView,
} from './admin/admin';
export {
  requestExport,
  listMyExports,
  exportFileFor,
  buildExportFiles,
  contentTypeOf,
  PORTABLE_FORMAT_VERSION,
  claimExport,
  completeExport,
  failExport,
  exportFileKeys,
  EXPORT_AVAILABLE_DAYS,
  EXPORT_BUILD_TIMEOUT_MS,
  EXPORT_MAX_ATTEMPTS,
  type ExportView,
  type ExportFile,
  type ExportScope,
  type ExportStatus,
  type ExportStorage,
  type ClaimedExport,
  type ExportTxRunner,
} from './exports/exports';
export { toCsv, type CsvValue } from './exports/csv';
export {
  adherence,
  getAnalytics,
  parseRange,
  MAX_RANGE_DAYS,
  type AnalyticsView,
  type AdherenceCounts,
  type DateRange,
  type Ratio,
} from './analytics/adherence';
export {
  clientCompliance,
  COMPLIANCE_WINDOWS,
  type ClientCompliance,
  type ComplianceWindow,
} from './analytics/compliance';
export {
  getPersonalRecords,
  getExerciseHistory,
  exerciseBestsBefore,
  isPersonalRecord,
  estimateOneRepMax,
  REP_MAX_COUNTS,
  E1RM_MAX_REPS,
  HISTORY_LIMIT,
  type ExerciseRecords,
  type ExerciseHistoryEntry,
  type SetRecord,
  type ExerciseBest,
} from './progress/records';
export {
  listMetrics,
  recordMetric,
  metricDef,
  metricUnit,
  metricToCanonical,
  metricFromCanonical,
  isBodyMetric,
  BODY_METRICS,
  METRIC_REASON_MAX,
  type BodyMetric,
  type MetricDef,
  type MetricKind,
  type MetricEntryView,
  type MetricsView,
  type RecordMetricInput,
} from './progress/metrics';
export { duplicateTemplate, setTemplateArchived, copyTitle } from './programs/library';
export {
  listTags,
  createTag,
  deleteTag,
  setClientTags,
  addTagToClients,
  BULK_MAX_CLIENTS,
  tagsForClients,
  TAG_COLORS,
  TAG_NAME_MAX,
  TAGS_PER_CLIENT_MAX,
  type TagColor,
  type TagView,
  type TagWithCount,
} from './clients/tags';
export {
  importClients,
  IMPORT_MAX_ROWS,
  type ImportRowInput,
  type ImportRowResult,
  type ImportResult,
} from './clients/import';
export {
  getClientContext,
  updateClientContext,
  setNotePinned,
  CONTEXT_FIELD_MAX,
  TRAINING_LOCATIONS,
  type TrainingLocation,
  PINNED_NOTES_MAX,
  type ClientContext,
  type ClientContextInput,
} from './clients/context';
export {
  getNutrition,
  setNutritionTarget,
  logNutrition,
  isOnTarget,
  MACROS,
  NUTRITION_BACKFILL_DAYS,
  NUTRITION_TOLERANCE,
  type Macro,
  type Macros,
  type NutritionDay,
  type NutritionView,
} from './nutrition/nutrition';
export {
  getReplyExpectations,
  updateReplyExpectations,
  listSavedReplies,
  createSavedReply,
  deleteSavedReply,
  fillSavedReply,
  REPLY_TARGETS,
  type ReplyExpectations,
  type SavedReplyView,
} from './messages/tools';
export {
  listHabits,
  createHabit,
  setHabitStatus,
  logHabit,
  summarizeHabit,
  HABIT_HISTORY_DAYS,
  HABIT_BACKFILL_DAYS,
  HABIT_TITLE_MAX,
  type HabitView,
  type HabitsView,
  type CreateHabitInput,
} from './habits/habits';
export {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  NOTE_MAX,
  type NoteView,
} from './history/notes';
export {
  getClientTimeline,
  TIMELINE_MAX,
  type TimelineEvent,
  type TimelineKind,
} from './history/timeline';
export {
  getMyThread,
  getClientThread,
  getThread,
  listThreads,
  countThreads,
  unreadByClient,
  THREAD_PAGE_SIZE,
  listMessages,
  sendMessage,
  unreadMessageCount,
  MESSAGE_MAX,
  MESSAGE_PAGE_SIZE,
  type MessageView,
  type ThreadSummary,
  type ThreadView,
  type MessageSentHook,
  searchMessages,
  MESSAGE_SEARCH_LIMIT,
  type MessageSearchHit,
} from './messages/messages';
export {
  SEEDED_QUESTIONS,
  QUESTION_TYPES,
  MAX_QUESTIONS,
  SHORT_TEXT_MAX,
  type CheckinQuestion,
  type CheckinAnswers,
  type CheckinAnswer,
  type QuestionType,
} from './checkins/questions';
export type { SlotKey, IsoWeekday, ScheduledSlot, ScheduleSlotsInput } from './schedule/types';
export {
  assignProgram,
  getAssignmentSummary,
  getProgramAssignee,
  type AssignProgramInput,
  type AssignProgramResult,
  type AssignmentSummary,
} from './assignments/assign';
export { reconcileSessions } from './assignments/reconcile';
export {
  SESSION_STATES,
  OPEN_STATES,
  PAST_STATES,
  type SessionState,
  type SessionSummary,
  type WorkoutVersionView,
} from './sessions/types';
export {
  resolveSessionWorkout,
  resolveSlotWorkoutVersionId,
  loadWorkoutVersionView,
} from './sessions/resolve';
export {
  listSessions,
  getPortalHome,
  isoWeekOf,
  encodeSessionCursor,
  decodeSessionCursor,
  type SessionListScope,
  type PortalHome,
} from './sessions/read';
export { readStoredTargets } from './programs/read';
export {
  assertEditableProgram,
  saveDraft,
  getDraft,
  discardDraft,
  MAX_DRAFT_BYTES,
  type ProgramDraftView,
} from './programs/drafts';
export { listProgramVersions, type ProgramVersionListItem } from './programs/versions';
export { startSession, completeSession, skipSession, type FinishInput } from './sessions/lifecycle';
export {
  getSessionDetail,
  type SessionDetail,
  type LoggedSet,
  type PreviousPerformance,
  type SetLogRevisionView,
} from './sessions/detail';
export {
  getClientHistory,
  getExercisePerformance,
  MAX_HISTORY_EXERCISES,
} from './sessions/history';
export { upsertSetLogs, type SetLogAck } from './logging/upsertSetLogs';
export { reviseSetLogs, type ReviseInput } from './logging/revise';
export { toSetLogValue, type SetLogValue, type RevisionValues } from './logging/values';
export {
  setLogInputSchema,
  logsBodySchema,
  finishBodySchema,
  MAX_SETS,
  COMMENT_MAX,
  EDIT_WINDOW_MS,
  REVISION_REASON_MAX,
  type SetLogInput,
} from './logging/schema';
export {
  getReviewOverview,
  getReviewCounts,
  markReviewSeen,
  REVIEW_LIST_MAX,
  type ReviewOverview,
  type ReviewItem,
  type ReviewSection,
} from './review/review';
export {
  getSetupChecklist,
  setSetupChecklistHidden,
  type SetupChecklist,
  type SetupStep,
  type SetupStepId,
} from './onboarding/setup';
export {
  getClientCalendar,
  rescheduleSession,
  RESCHEDULE_MAX_DAYS_AHEAD,
  type CalendarCheckin,
  type CalendarWorkout,
  type ClientCalendar,
} from './sessions/calendar';
export {
  getReviewRuleSettings,
  updateReviewRuleSettings,
  OPT_IN_RULES,
  PROGRAM_ENDING_DAYS,
  WEIGHT_BAND,
  type OptInRule,
  type ReviewRuleSettings,
} from './review/optInRules';
export {
  matchExercises,
  createProgramFromImport,
  nameScore,
  MATCH_NAMES_MAX,
  type ExerciseMatch,
} from './programs/import';
export {
  listAlternatives,
  setAlternatives,
  MAX_ALTERNATIVES,
  type AlternativeView,
} from './exercises/alternatives';
export {
  swapExercise,
  undoSwap,
  SWAP_REASONS,
  type SwapReason,
  type SwapView,
} from './sessions/swaps';
export {
  listSharedWorkouts,
  searchExtraExercises,
  startExtraWorkout,
  setProgramShared,
  EXTRA_MAX_EXERCISES,
  type SharedWorkout,
  type ExtraExerciseOption,
} from './sessions/extra';
export {
  listGoals,
  createGoal,
  setGoalStatus,
  goalStatus,
  GOAL_KINDS,
  EXERCISE_MEASURES,
  ACTIVE_GOALS_MAX,
  HABIT_WINDOW_DAYS,
  type GoalKind,
  type GoalLabel,
  type GoalView,
  type ExerciseMeasure,
  type CreateGoalInput,
} from './goals/goals';
export { checkinWeekSummary, type CheckinWeekSummary } from './checkins/weekSummary';
export { checkinResponsesCsv } from './checkins/responsesCsv';
export {
  addSessionNote,
  NOTE_MAX as SESSION_NOTE_MAX,
  type SessionNoteView,
} from './sessions/notes';
export { metricsAsOf, type MetricAsOf } from './progress/metricsAsOf';
export {
  broadcastAudiences,
  broadcastMessage,
  BROADCAST_MAX_RECIPIENTS,
  type BroadcastAudience,
} from './messages/broadcast';
export {
  listResources,
  createResource,
  archiveResource,
  RESOURCE_BODY_MAX,
  RESOURCE_TITLE_MAX,
  type ResourceAudience,
  type ResourceView,
} from './resources/resources';
export { queueCoachDigests, DIGEST_HOUR } from './notifications/digest';
export {
  queueClientReminders,
  REMINDER_HOURS,
  REMINDERS_PER_DAY,
  type ReminderKind,
} from './notifications/reminders';
export { getBranding, updateBranding, type Branding } from './branding/branding';
export {
  replyFacts,
  fillPlaceholders,
  REPLY_PLACEHOLDERS,
  type ReplyPlaceholder,
} from './messages/replyFacts';
export { equipmentGuideFor, type EquipmentGuide } from './exercises/equipmentGuide';
export { setExerciseDemo } from './exercises/demo';
export {
  convertLead,
  getPublicPageSettings,
  getPublicProfile,
  LEAD_STATUSES,
  listLeads,
  submitLead,
  updateLead,
  updatePublicPage,
  type LeadStatus,
  type LeadView,
  type PublicPageSettings,
  type PublicProfile,
} from './leads/leads';
export { CLIENT_EVENTS, emitClientEvent, type ClientEventKind } from './automations/events';
export { decideStepRun, processClientEvents, runDueSteps } from './automations/engine';
export {
  archiveSequence,
  cancelRun,
  listSequences,
  runHistory,
  saveSequence,
  SEQUENCE_TEMPLATES,
  SEQUENCE_TRIGGERS,
  startSequence,
  STEP_TYPES,
  type RunHistoryItem,
  type SequenceTrigger,
  type SequenceView,
  type StepInput,
  type StepType,
} from './automations/sequences';
export {
  addPhase,
  advancePhases,
  listPhases,
  PHASES_MAX,
  removePhase,
  startPhase,
  type PhaseMode,
  type PhaseView,
} from './programs/phases';
export {
  defaultScope,
  parseScope,
  scopeCoachIds,
  transferClient,
  type ClientScope,
} from './team/scope';
export {
  activeCover,
  cancelCover,
  coverForClient,
  createCover,
  listCovers,
  type CoverView,
} from './team/cover';
export {
  acceptTeamInvite,
  changeTeamRole,
  inviteTeammate,
  listTeam,
  lookupTeamInvite,
  removeTeammate,
  revokeTeamInvite,
  TEAM_ROLES,
  type TeamInviteLookup,
  type TeamInviteView,
  type TeamMemberView,
  type TeamRole,
} from './team/team';
export {
  calendarFeed,
  hasCalendarFeed,
  revokeCalendarToken,
  rotateCalendarToken,
} from './calendar/feed';
export {
  acceptAgreement,
  acceptancesFor,
  archiveAgreement,
  createAgreement,
  listAgreements,
  pendingAgreements,
  updateAgreement,
  type AcceptanceView,
  type AgreementView,
} from './agreements/agreements';
export { queueWeeklyBriefs, weeklyBriefFacts, type WeeklyBrief } from './notifications/brief';
export {
  ENGAGEMENT_WEEKS,
  getEngagement,
  recordPortalVisit,
  type EngagementWeek,
} from './progress/engagement';
export {
  LIFECYCLE_STAGES,
  SETTABLE_STAGES,
  STAGE_LABEL,
  setLifecycleStage,
  type LifecycleStage,
  type SettableStage,
} from './clients/stage';
export {
  AUDIT_CATEGORIES,
  listAuditLog,
  type AuditCategory,
  type AuditEntry,
} from './audit/ownerLog';
export {
  cancelScheduledMessage,
  listScheduledMessages,
  scheduleMessage,
  SCHEDULED_PER_THREAD,
  sendDueScheduledMessages,
  type ScheduledMessageView,
} from './messages/scheduled';
export {
  getTrainingLoad,
  TRAINING_LOAD_WEEKS,
  type TrainingLoad,
  type TrainingLoadWeek,
} from './progress/trainingLoad';
export {
  deletePushSubscription,
  deliverPushes,
  enqueuePush,
  hasPushSubscription,
  isPushServiceEndpoint,
  PUSH_KINDS,
  releaseEndpoint,
  savePushSubscription,
  vapidAuthorization,
  vapidKeys,
  type PushKind,
} from './notifications/push';
export { twoFactorStatus, type TwoFactorStatus } from './identity/twoFactor';
export {
  clearSsoSetting,
  emailDomain,
  getSsoSetting,
  microsoftLinkAllowed,
  microsoftTenantFromIdToken,
  saveSsoSetting,
  ssoRequiredFor,
  type SsoProvider,
  type SsoSettingView,
} from './identity/sso';
export { recordReadiness, readReadiness, type ReadinessView } from './sessions/readiness';
export {
  READINESS_QUESTIONS,
  readinessScore,
  type ReadinessAnswers,
  type ReadinessKey,
} from './sessions/readiness-questions';
export {
  parseAnchorRef,
  resolveAnchor,
  type AnchorType,
  type MessageAnchor,
} from './messages/anchors';
export {
  createJoinLink,
  joinWithLink,
  listJoinLinks,
  lookupJoinLink,
  revokeJoinLink,
  JOIN_LINK_DAYS,
  JOIN_LINK_MAX_USES,
  type JoinLinkView,
} from './invites/joinLinks';
export {
  createCheckinTemplate,
  getCheckinTemplateById,
  listCheckinTemplates,
  sendForm,
  updateCheckinTemplateById,
  FORM_DAYS,
  TEMPLATE_KINDS,
  type TemplateKind,
} from './checkins/checkins';
export { CONTEXT_FIELDS, type ContextField } from './checkins/questions';
export {
  postNotice,
  readNotices,
  resolveNotice,
  NOTICE_SEVERITIES,
  RELIABILITY_TARGETS,
  type NoticeSeverity,
  type NoticeView,
} from './admin/notices';
export { requestSupport, SUPPORT_RESPONSE_TARGET, SUPPORT_TOPICS } from './admin/support';
export {
  eraseMedia,
  mediaForDownload,
  MEDIA_PURPOSES,
  ownMedia,
  prepareUpload,
  purgeErasedMedia,
  recordMedia,
  storageKeyFor,
  uploadOwner,
  type MediaPurpose,
} from './media/media';
export {
  addProgressPhoto,
  deleteProgressPhoto,
  listProgressPhotos,
  POSES,
  type Pose,
  type ProgressPhotoView,
} from './media/progressPhotos';
export { addFormCheck, FORM_CHECKS_PER_SESSION, type FormCheckView } from './sessions/formChecks';
export {
  archiveCourse,
  clientCourses,
  COURSE_CADENCES,
  enrollClient,
  endEnrollment,
  getCourse,
  LESSONS_MAX,
  listCourses,
  myCourses,
  saveCourse,
  setLessonDone,
  unlockDate,
  unlockedCount,
  type CourseCadence,
  type CourseDetail,
  type CourseSummary,
  type EnrollmentProgress,
  type LessonInput,
  type PortalCourse,
  type PortalLesson,
} from './courses/courses';
export {
  addAssessmentPhoto,
  archiveAssessment,
  assignAssessment,
  clientAssessments,
  deleteAssessmentPhoto,
  endClientAssessment,
  GUIDES,
  listAssessments,
  nextDue,
  saveAssessment,
  type AssessmentPhotoView,
  type AssessmentView,
  type ClientAssessmentView,
  type Guide,
} from './assessments/assessments';
export {
  deleteProgressReport,
  listProgressReports,
  monthLabel,
  progressReportData,
  renderProgressReport,
  saveProgressReport,
  type ProgressReportView,
  type ReportData,
} from './reports/progressReport';
export {
  archiveMealPlan,
  archiveRecipe,
  clientMealPlan,
  getRecipe,
  listMealPlans,
  listRecipes,
  saveMealPlan,
  saveRecipe,
  setClientMealPlan,
  shoppingList,
  type Ingredient,
  type MealOptionInput,
  type MealPlanDay,
  type MealPlanView,
  type RecipeView,
  type ShoppingItem,
} from './nutrition/mealPlans';
export {
  archiveGroup,
  commentOnPost,
  dismissGroupReport,
  displayName,
  getGroup,
  listGroups,
  moderateGroupItem,
  muteMember,
  postToGroup,
  reactToPost,
  REACTIONS,
  reportGroupItem,
  saveGroup,
  setGroupMembers,
  type GroupComment as GroupCommentView,
  type GroupDetail,
  type GroupItem,
  type GroupItemKind,
  type GroupReportView,
  type GroupSummary,
  type Reaction,
} from './groups/groups';
export {
  archiveChallenge,
  CHALLENGE_METRICS,
  getChallenge,
  joinChallenge,
  leaveChallenge,
  listChallenges,
  saveChallenge,
  type ChallengeDetail,
  type ChallengeMetric,
  type ChallengeStatus,
  type ChallengeSummary,
  type LeaderboardEntry,
} from './challenges/challenges';
export { getBusinessAnalytics, type BusinessAnalytics, type Cohort } from './analytics/business';
export {
  bucketOf,
  getAdherenceSeries,
  getCheckinSeries,
  getClientAdherence,
  getClientConsistency,
  getDailySessionStates,
  getExerciseProgress,
  getStreak,
  getWeeklyVolume,
  pctOf,
  type AdherenceWeek,
  type CheckinSeries,
  type ClientAdherenceRow,
  type DayStates,
  type ExerciseProgressPoint,
  type StateBucket,
  type StateCounts,
} from './analytics/series';
export { CHURN_LABEL, CHURN_REASONS, type ChurnReason } from './clients/churn';

// --- R3 remaining features (2026-11-03) ---
export {
  FakePaymentsProvider,
  calculateTax,
  defaultProviderForCurrency,
  fakePaymentsProvider,
  onlinePaymentsAvailable,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  formatMoneyMinor,
  type CheckoutSession,
  type Money,
  type PaymentsPort,
  type ProviderKind,
  type TaxQuote,
} from './billing/payments';
export {
  applyCoupon,
  archivePackage,
  couponProblem,
  createCheckout,
  listPackages,
  listStorefrontPackages,
  nextChargeDate,
  paymentPlanSchedule,
  purchaseSetup,
  saveCoupon,
  savePackage,
  trialEndDate,
  validateCoupon,
  type BillingTx,
  type CouponView,
  type PackageKind,
  type PackageView,
} from './billing/packages';
export { getPublicStorefront } from './billing/storefront';
export {
  accessPaused,
  applyGraceExpiry,
  clientBillingPaused,
  chargeDueRenewal,
  expireGraces,
  periodAfterCharge,
  retryDueSubscription,
  cancelSubscription,
  confirmCheckout,
  cancellationEndDate,
  getBillingSelfService,
  getReceipt,
  gracePeriodEnd,
  handleFailedPayment,
  listSubscriptions,
  nextRetryAt,
  recordManualPayment,
  refundPayment,
  retrySubscriptionPayment,
  type ReceiptView,
  type SelfServiceView,
  type SubscriptionStatus,
  type SubscriptionView,
} from './billing/billing';
export {
  billingCsv,
  computeBillingAnalytics,
  getBillingAnalytics,
  monthlyBillingRows,
  monthlyEquivalent,
  type BillingAnalytics,
  type MonthlyBillingRow,
} from './billing/analytics';
export {
  cancelBooking,
  createBooking,
  bookingsClash,
  generateSlots,
  withinAvailability,
  listBookings,
  listSessionTypes,
  saveSessionType,
  spansOverlap,
  validateCallLink,
  SESSION_TYPE_KINDS,
  type AvailabilityWindow,
  type BookingView,
  type SessionTypeKind,
  type SessionTypeView,
  type Slot,
} from './scheduling/scheduling';
export {
  consumePackCredit,
  listPacks,
  packBalance,
  packStatusOf,
  purchasePack,
  refundPackCredit,
  isPackUsable,
  type PackView,
} from './scheduling/packs';
export {
  scheduleRenewalReminders,
  startPackageOnboarding,
  cleanJourneySteps,
  renewalReminderDate,
  type PackageJourneyStep,
  type PackageJourneyView,
} from './scheduling/journeys';
export {
  FakeCalendarSync,
  bookingToExternalEvent,
  removeBookingFromCalendar,
  syncBookingToCalendar,
  type BookingForSync,
  type CalendarProvider,
  type CalendarSyncPort,
  type ExternalCalendarEvent,
} from './scheduling/calendarSync';
export {
  assertLapseAllows,
  assertWritable,
  CLIENT_LAPSE_DAYS,
  COACH_LAPSE_DAYS,
  enforceReadOnly,
  getLapseAccess,
  lapseAccess,
  setSubscriptionLapse,
  type LapseAccess,
  type LapseAction,
  type LapseActorKind,
  type LapseView,
} from './lapse/lapse';
export {
  assertAiEnabled,
  getAiSetting,
  setAiActionsEnabled,
  setAiSetting,
  type AiSettingView,
} from './ai/settings';
export {
  ACTION_TOOLS,
  ACTION_TOOL_NAMES,
  AI_ACTION_TTL_MS,
  MEAL_PLAN_TOLERANCE,
  applyAiAction,
  canUseAssistantActions,
  cancelAiAction,
  linkAiActions,
  listAiActions,
  markAiActionFailed,
  mealPlanMisses,
  runActionTool,
  type ActionToolResult,
  type AiActionKind,
  type AiActionStatus,
  type AiActionView,
} from './ai/actions';
export {
  ASSISTANT_TOOLS,
  ASSISTANT_TOOL_NAMES,
  runAssistantTool,
  type AssistantToolDef,
  type AssistantToolResult,
} from './ai/assistantTools';
export {
  AI_CONVERSATION_RETENTION_DAYS,
  AI_MESSAGE_MAX_CHARS,
  appendAiExchange,
  cleanQuestion,
  conversationTitle,
  createAiConversation,
  deleteAiConversation,
  getAiConversation,
  listAiConversations,
  purgeOldAiConversations,
  type AiConversationSummary,
  type AiConversationView,
  type AiMessageView,
} from './ai/conversations';
export {
  coachBusyTimes,
  coachConnectionForSessionType,
  disconnectCalendar,
  getCalendarConnection,
  saveGoogleConnection,
  signCalendarState,
  syncPendingBookings,
  verifyCalendarState,
  type CalendarConnectionView,
} from './calendar/connections';
export {
  exchangeGoogleCode,
  googleConsentUrl,
  googleOAuthConfig,
  GoogleCalendarError,
  GoogleCalendarSync,
  revokeGoogleToken,
  type GoogleOAuthConfig,
} from './calendar/google';
export { decryptToken, encryptToken } from './calendar/tokenCrypto';
export {
  deleteFromStream,
  mediaPlayback,
  processVideoStreams,
  STREAM_PURPOSES,
  streamConfig,
  streamStatus,
  uploadToStream,
  type StreamConfig,
} from './media/stream';
export {
  listLocations,
  listStaffLocations,
  saveLocation,
  setClientLocation,
  setLocationArchived,
  setStaffLocation,
  type LocationStaffView,
  type LocationView,
} from './locations/locations';
export {
  cancelClass,
  cancelEnrollment,
  classRoster,
  createClassSeries,
  enrollInClass,
  listClasses,
  markAttendance,
  MAX_CLASS_REPEATS,
  setClassCapacity,
  type ClassView,
  type RosterEntry,
} from './classes/classes';
