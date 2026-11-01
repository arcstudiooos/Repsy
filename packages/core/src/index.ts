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
export { canonicalTimezone, isIanaTimezone, todayInZone } from './timezone';
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
export { twoFactorStatus, type TwoFactorStatus } from './identity/twoFactor';
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
