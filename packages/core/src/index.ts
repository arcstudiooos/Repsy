export const CORE_VERSION = '0.0.0';
export type { EmailMessage, EmailPort } from './ports/email';
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
export { signupCoach, type SignupCoachInput } from './identity/signupCoach';
export { generatePilotCode, hashPilotCode, normalizePilotCode } from './identity/pilotCode';
export { createLogger, logger, type Logger } from './log';
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
  GOALS_MAX,
  type ClientView,
  type ClientStatus,
} from './clients/clients';
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
export { isValidTimezone } from './invites/invites';
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
export { toDisplay, fromDisplay, type Units } from './units';
export { scheduleSlots, ScheduleInputError } from './schedule/scheduleSlots';
export type { SlotKey, IsoWeekday, ScheduledSlot, ScheduleSlotsInput } from './schedule/types';
