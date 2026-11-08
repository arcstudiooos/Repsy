import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan, can } from '../authz/policies';
import { assignProgram } from '../assignments/assign';
import { DomainError } from '../errors';
import { saveMealPlan, setClientMealPlan } from '../nutrition/mealPlans';
import { setNutritionTarget } from '../nutrition/nutrition';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import type { AssistantToolDef } from './assistantTools';

/**
 * PRD I15 actions. The assistant can PROPOSE four kinds of change. A proposal is stored and shown to the coach as a
 * card; nothing changes until that same coach presses Confirm. Applying runs the domain function the screens use,
 * inside the coach's tenant transaction, so their role and row-level security decide what is allowed, exactly as if
 * they had used the screen. Proposals are checked when they are made (so the model can fix mistakes) and again when
 * they are applied.
 */
export type AiActionKind =
  'assign_program' | 'set_nutrition_targets' | 'meal_plan' | 'assign_meal_plan';
export type AiActionStatus = 'proposed' | 'applied' | 'cancelled' | 'failed' | 'expired';

/** A proposal not confirmed within this long can no longer be applied (the data it was based on may have moved). */
export const AI_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

/** How far a meal plan day may land from the daily targets: calories within 5%, each macro within 10% (or 5 g). */
export const MEAL_PLAN_TOLERANCE = { caloriesPct: 0.05, macroPct: 0.1, macroMinG: 5 };

export interface AiActionView {
  id: string;
  messageId: string | null;
  kind: AiActionKind;
  summary: string;
  /** What the card shows: the checked details of the change. */
  details: unknown;
  status: AiActionStatus;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const MACROS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
type Macro = (typeof MACROS)[number];
type Macros = Record<Macro, number>;

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });
const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const macrosSchema = (what: string) => ({
  type: 'object',
  description: what,
  properties: {
    calories: int('Kilocalories.'),
    proteinG: int('Protein in grams.'),
    carbsG: int('Carbohydrates in grams.'),
    fatG: int('Fat in grams.'),
  },
  required: ['calories', 'proteinG', 'carbsG', 'fatG'],
  additionalProperties: false,
});

export const ACTION_TOOLS: AssistantToolDef[] = [
  {
    name: 'propose_assign_program',
    description:
      'Proposes putting a client on a template program from a start date, training on the given weekdays. The coach must confirm before anything changes. Find the ids with list_clients and list_programs first; the number of weekdays must equal the training days per week of the program (get_program shows them).',
    input_schema: {
      type: 'object',
      properties: {
        clientId: str('The client id.'),
        templateProgramId: str('The template program id (kind "template").'),
        startDate: str('First day, YYYY-MM-DD, today or later in the client time zone.'),
        weekdays: {
          type: 'array',
          items: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7] },
          description: 'Training weekdays, ISO numbers: 1 Monday to 7 Sunday.',
        },
      },
      required: ['clientId', 'templateProgramId', 'startDate', 'weekdays'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_nutrition_targets',
    description:
      "Proposes daily nutrition targets (calories and macros) for a client from a date on. The coach must confirm. Check the client's profile, goals and current targets first.",
    input_schema: {
      type: 'object',
      properties: {
        clientId: str('The client id.'),
        targets: macrosSchema('Daily targets.'),
        effectiveFrom: nullable('string', 'YYYY-MM-DD the targets start; null for today.'),
      },
      required: ['clientId', 'targets', 'effectiveFrom'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_meal_plan',
    description:
      "Proposes a meal plan for one client (usually 7 days) that hits daily targets, and gives it to the client. Each day's total, counting the FIRST option of every meal, must be within 5% of the calorie target and within 10% (or 5 g) of each macro target, or the tool rejects it and says by how much each day is off. Use the workspace's recipes (list_recipes) where they fit, or describe a meal with its macros. Respect the client's preferences, allergies and diet in their profile.",
    input_schema: {
      type: 'object',
      properties: {
        clientId: str('The client id.'),
        title: str('Plan title, for example "Priya: week of 10 Nov".'),
        notes: str('Short notes for the client (empty string for none).'),
        targets: macrosSchema('The daily targets every day must hit.'),
        alsoSetTargets: {
          type: 'boolean',
          description: "Also save these targets as the client's daily nutrition targets.",
        },
        days: {
          type: 'array',
          description: 'The days of the plan, 1 to 14.',
          items: {
            type: 'object',
            properties: {
              name: str('Day name, for example "Monday".'),
              meals: {
                type: 'array',
                description: 'Meals of the day, 1 to 8.',
                items: {
                  type: 'object',
                  properties: {
                    name: str('Meal name, for example "Breakfast".'),
                    options: {
                      type: 'array',
                      description:
                        'One to five options to swap between. The first counts toward the day total.',
                      items: {
                        type: 'object',
                        properties: {
                          recipeId: nullable(
                            'string',
                            'A recipe id, or null for a described meal.',
                          ),
                          servings: nullable(
                            'number',
                            'Servings of the recipe (0.25 to 10), or null.',
                          ),
                          text: nullable(
                            'string',
                            'The described meal with amounts, for example "200 g paneer tikka, 1 roti". Null for a recipe.',
                          ),
                          calories: nullable(
                            'integer',
                            'Kilocalories of a described meal; null for a recipe.',
                          ),
                          proteinG: nullable('integer', 'Protein grams; null for a recipe.'),
                          carbsG: nullable('integer', 'Carb grams; null for a recipe.'),
                          fatG: nullable('integer', 'Fat grams; null for a recipe.'),
                        },
                        required: [
                          'recipeId',
                          'servings',
                          'text',
                          'calories',
                          'proteinG',
                          'carbsG',
                          'fatG',
                        ],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['name', 'options'],
                  additionalProperties: false,
                },
              },
            },
            required: ['name', 'meals'],
            additionalProperties: false,
          },
        },
      },
      required: ['clientId', 'title', 'notes', 'targets', 'alsoSetTargets', 'days'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_assign_meal_plan',
    description:
      'Proposes giving a client an existing meal plan from the workspace library (list_meal_plans), replacing their current one. The coach must confirm.',
    input_schema: {
      type: 'object',
      properties: {
        clientId: str('The client id.'),
        mealPlanId: str('The meal plan id.'),
      },
      required: ['clientId', 'mealPlanId'],
      additionalProperties: false,
    },
  },
];

export const ACTION_TOOL_NAMES = ACTION_TOOLS.map((t) => t.name);

class ProposalError extends Error {}

type Input = Record<string, unknown>;
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function activeClient(tx: TenantTx, actor: ActorContext, clientId: unknown) {
  const id = text(clientId, 64);
  if (!isUuid(id)) throw new ProposalError('No client with that id in this workspace.');
  const client = await tx.client.findFirst({
    where: { id, organizationId: actor.orgId },
    select: { id: true, name: true, status: true, timezone: true },
  });
  if (!client) throw new ProposalError('No client with that id in this workspace.');
  if (client.status === 'archived') throw new ProposalError(`${client.name} is archived.`);
  return client;
}

function readMacros(v: unknown, label: string): Macros {
  const o = (v ?? {}) as Input;
  const out = {} as Macros;
  for (const m of MACROS) {
    const n = o[m];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      throw new ProposalError(`${label}: ${m} must be a whole number.`);
    }
    out[m] = n;
  }
  if (out.calories < 800 || out.calories > 6000) {
    throw new ProposalError(`${label}: calories must be between 800 and 6000.`);
  }
  const fromMacros = out.proteinG * 4 + out.carbsG * 4 + out.fatG * 9;
  if (Math.abs(fromMacros - out.calories) > out.calories * 0.1) {
    throw new ProposalError(
      `${label}: protein, carbs and fat add up to ${fromMacros} kcal, more than 10% from ${out.calories} kcal. Make them consistent.`,
    );
  }
  return out;
}

const fmtMacros = (m: Macros) =>
  `${m.calories} kcal, ${m.proteinG} g protein, ${m.carbsG} g carbs, ${m.fatG} g fat`;

// ---------------------------------------------------------------- proposals

async function proposeAssignProgram(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'assignment:write');
  const client = await activeClient(tx, actor, input.clientId);
  if (client.status !== 'active') {
    throw new ProposalError(
      `${client.name} is ${client.status}; programs can only be assigned to active clients.`,
    );
  }
  const templateId = text(input.templateProgramId, 64);
  const template = isUuid(templateId)
    ? await tx.program.findFirst({
        where: { id: templateId, organizationId: actor.orgId, kind: 'template' },
        select: { id: true, title: true, status: true, currentVersionId: true },
      })
    : null;
  if (!template)
    throw new ProposalError('No template program with that id. Client copies cannot be assigned.');
  if (template.status === 'archived' || !template.currentVersionId) {
    throw new ProposalError(`"${template.title}" is archived or not saved yet.`);
  }
  const version = await tx.programVersion.findFirst({
    where: { id: template.currentVersionId },
    select: { daysPerWeek: true, weekCount: true },
  });
  const weekdays = Array.isArray(input.weekdays) ? (input.weekdays as unknown[]) : [];
  const days = [...new Set(weekdays)].filter(
    (d): d is number => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7,
  );
  if (days.length !== weekdays.length)
    throw new ProposalError('Weekdays must be distinct numbers 1 to 7.');
  if (version && days.length !== version.daysPerWeek) {
    throw new ProposalError(
      `"${template.title}" trains ${version.daysPerWeek} days a week; give exactly ${version.daysPerWeek} weekdays.`,
    );
  }
  const startDate = text(input.startDate, 10);
  if (!isDay(startDate)) throw new ProposalError('Start date must be YYYY-MM-DD.');
  if (startDate < todayInZone(client.timezone))
    throw new ProposalError('Start date cannot be in the past.');
  const current = await tx.programAssignment.findFirst({
    where: { clientId: client.id, status: 'active' },
    select: { program: { select: { title: true } } },
  });
  days.sort((a, b) => a - b);
  const details = {
    clientId: client.id,
    clientName: client.name,
    templateProgramId: template.id,
    programTitle: template.title,
    weeks: version?.weekCount ?? null,
    startDate,
    weekdays: days,
    replaces: current?.program.title ?? null,
  };
  const summary =
    `Put ${client.name} on "${template.title}" from ${startDate}, training ${days.map((d) => WEEKDAY[d]).join(', ')}` +
    (current
      ? `. This replaces "${current.program.title}" (unstarted sessions from the start date are cancelled).`
      : '.');
  return { kind: 'assign_program' as const, clientId: client.id, summary, details };
}

async function proposeNutritionTargets(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'nutrition:manage');
  const client = await activeClient(tx, actor, input.clientId);
  const targets = readMacros(input.targets, 'Targets');
  const from =
    input.effectiveFrom === null || input.effectiveFrom === undefined
      ? null
      : text(input.effectiveFrom, 10);
  if (from !== null && !isDay(from))
    throw new ProposalError('effectiveFrom must be YYYY-MM-DD or null.');
  const details = { clientId: client.id, clientName: client.name, targets, effectiveFrom: from };
  const summary = `Set ${client.name}'s daily targets to ${fmtMacros(targets)}${from ? ` from ${from}` : ' from today'}.`;
  return { kind: 'set_nutrition_targets' as const, clientId: client.id, summary, details };
}

interface PlanOption {
  recipeId?: string;
  servings?: number;
  text?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}
interface PlanDay {
  name: string;
  meals: { name: string; options: PlanOption[] }[];
}

/** Normalises the model's days into the meal-plan input shape, and returns each day's totals from first options. */
async function readPlanDays(
  tx: TenantTx,
  raw: unknown,
): Promise<{ days: PlanDay[]; totals: Macros[]; titles: string[][] }> {
  const daysIn = Array.isArray(raw) ? raw : [];
  if (daysIn.length < 1 || daysIn.length > 14) throw new ProposalError('Give 1 to 14 days.');
  const recipeIds = new Set<string>();
  for (const d of daysIn as Input[]) {
    for (const m of (Array.isArray(d?.meals) ? d.meals : []) as Input[]) {
      for (const o of (Array.isArray(m?.options) ? m.options : []) as Input[]) {
        if (typeof o?.recipeId === 'string' && o.recipeId) recipeIds.add(o.recipeId);
      }
    }
  }
  const bad = [...recipeIds].filter((id) => !isUuid(id));
  if (bad.length) throw new ProposalError(`Unknown recipe id ${bad[0]}.`);
  const recipes = new Map(
    (
      await tx.recipe.findMany({
        where: { id: { in: [...recipeIds] }, archivedAt: null },
        select: { id: true, title: true, calories: true, proteinG: true, carbsG: true, fatG: true },
      })
    ).map((r) => [r.id, r]),
  );
  const totals: Macros[] = [];
  const titles: string[][] = [];
  const days: PlanDay[] = (daysIn as Input[]).map((d, di) => {
    const dayName = text(d.name, 40) || `Day ${di + 1}`;
    const mealsIn = Array.isArray(d.meals) ? (d.meals as Input[]) : [];
    if (mealsIn.length < 1 || mealsIn.length > 8)
      throw new ProposalError(`${dayName}: give 1 to 8 meals.`);
    const total: Macros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    const dayTitles: string[] = [];
    const meals = mealsIn.map((m) => {
      const mealName = text(m.name, 40);
      if (!mealName) throw new ProposalError(`${dayName}: every meal needs a name.`);
      const optsIn = Array.isArray(m.options) ? (m.options as Input[]) : [];
      if (optsIn.length < 1 || optsIn.length > 5)
        throw new ProposalError(`${dayName} ${mealName}: give 1 to 5 options.`);
      const options = optsIn.map((o, oi): PlanOption & { macros: Macros; title: string } => {
        if (typeof o.recipeId === 'string' && o.recipeId) {
          const r = recipes.get(o.recipeId);
          if (!r) throw new ProposalError(`Recipe ${o.recipeId} does not exist in this workspace.`);
          if ([r.calories, r.proteinG, r.carbsG, r.fatG].some((v) => v === null)) {
            throw new ProposalError(
              `Recipe "${r.title}" has no full macros; describe that meal instead.`,
            );
          }
          const servings = typeof o.servings === 'number' ? Math.round(o.servings * 100) / 100 : 1;
          if (servings < 0.25 || servings > 10)
            throw new ProposalError(`"${r.title}": use 0.25 to 10 servings.`);
          const scale = (v: number | null) => Math.round((v ?? 0) * servings);
          return {
            recipeId: r.id,
            servings,
            title: `${r.title} (${servings} serving${servings === 1 ? '' : 's'})`,
            macros: {
              calories: scale(r.calories),
              proteinG: scale(r.proteinG),
              carbsG: scale(r.carbsG),
              fatG: scale(r.fatG),
            },
          };
        }
        const t = text(o.text, 200);
        if (!t)
          throw new ProposalError(
            `${dayName} ${mealName} option ${oi + 1}: describe the meal or pick a recipe.`,
          );
        const mm = {} as Macros;
        for (const k of MACROS) {
          const v = o[k];
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
            throw new ProposalError(`${dayName} ${mealName} "${t}": give whole-number ${k}.`);
          }
          mm[k] = v;
        }
        return { text: t, ...mm, title: t, macros: mm };
      });
      const first = options[0]!;
      for (const k of MACROS) total[k] += first.macros[k];
      dayTitles.push(`${mealName}: ${first.title}`);
      return {
        name: mealName,
        options: options.map((o) => {
          const rest: Record<string, unknown> = { ...o };
          delete rest.macros;
          delete rest.title;
          return rest;
        }),
      };
    });
    totals.push(total);
    titles.push(dayTitles);
    return { name: dayName, meals };
  });
  return { days, totals, titles };
}

/** Each day that misses the targets, with how far it is off. Empty when every day is within tolerance. */
export function mealPlanMisses(targets: Macros, totals: Macros[], names: string[]): string[] {
  const misses: string[] = [];
  totals.forEach((t, i) => {
    const off: string[] = [];
    for (const k of MACROS) {
      const allowed =
        k === 'calories'
          ? targets.calories * MEAL_PLAN_TOLERANCE.caloriesPct
          : Math.max(targets[k] * MEAL_PLAN_TOLERANCE.macroPct, MEAL_PLAN_TOLERANCE.macroMinG);
      const diff = t[k] - targets[k];
      if (Math.abs(diff) > allowed) off.push(`${k} ${t[k]} (${diff > 0 ? '+' : ''}${diff})`);
    }
    if (off.length) misses.push(`${names[i]}: ${off.join(', ')}`);
  });
  return misses;
}

async function proposeMealPlan(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'nutrition:manage');
  const client = await activeClient(tx, actor, input.clientId);
  const targets = readMacros(input.targets, 'Targets');
  const title = text(input.title, 120);
  if (!title) throw new ProposalError('Give the plan a title.');
  const notes = text(input.notes, 2000);
  const { days, totals, titles } = await readPlanDays(tx, input.days);
  const misses = mealPlanMisses(
    targets,
    totals,
    days.map((d) => d.name),
  );
  if (misses.length) {
    throw new ProposalError(
      `These days miss the targets (${fmtMacros(targets)}); adjust portions or meals and propose again. ${misses.join('; ')}.`,
    );
  }
  const alsoSetTargets = input.alsoSetTargets === true;
  const details = {
    clientId: client.id,
    clientName: client.name,
    title,
    notes,
    targets,
    alsoSetTargets,
    days,
    preview: days.map((d, i) => ({ name: d.name, totals: totals[i], meals: titles[i] })),
  };
  const summary =
    `Create the ${days.length}-day meal plan "${title}" for ${client.name} (every day within range of ${fmtMacros(targets)}) and give it to them` +
    (alsoSetTargets ? ', and set these as their daily targets.' : '.');
  return { kind: 'meal_plan' as const, clientId: client.id, summary, details };
}

async function proposeAssignMealPlan(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'nutrition:manage');
  const client = await activeClient(tx, actor, input.clientId);
  const planId = text(input.mealPlanId, 64);
  const plan = isUuid(planId)
    ? await tx.mealPlan.findFirst({
        where: { id: planId, archivedAt: null },
        select: { id: true, title: true },
      })
    : null;
  if (!plan) throw new ProposalError('No meal plan with that id.');
  const details = {
    clientId: client.id,
    clientName: client.name,
    mealPlanId: plan.id,
    title: plan.title,
  };
  return {
    kind: 'assign_meal_plan' as const,
    clientId: client.id,
    summary: `Give ${client.name} the meal plan "${plan.title}", replacing their current plan.`,
    details,
  };
}

const PROPOSERS: Record<
  string,
  (
    tx: TenantTx,
    actor: ActorContext,
    input: Input,
  ) => Promise<{
    kind: AiActionKind;
    clientId: string;
    summary: string;
    details: unknown;
  }>
> = {
  propose_assign_program: proposeAssignProgram,
  propose_nutrition_targets: proposeNutritionTargets,
  propose_meal_plan: proposeMealPlan,
  propose_assign_meal_plan: proposeAssignMealPlan,
};

export interface ActionToolResult {
  ok: boolean;
  content: string;
  actionId?: string;
}

/** Runs a `propose_*` tool: checks it and stores the proposal for the coach to confirm. */
export async function runActionTool(
  tx: TenantTx,
  actor: ActorContext,
  name: string,
  input: unknown,
  ctx: { conversationId: string },
): Promise<ActionToolResult> {
  const proposer = PROPOSERS[name];
  if (!proposer) return { ok: false, content: `Unknown tool "${name}".` };
  const setting = await tx.aiSetting.findFirst({
    where: { organizationId: actor.orgId },
    select: { actionsEnabled: true },
  });
  if (!setting?.actionsEnabled) {
    return { ok: false, content: 'Changes by the assistant are turned off for this workspace.' };
  }
  try {
    const p = await proposer(tx, actor, input && typeof input === 'object' ? (input as Input) : {});
    const row = await tx.aiAction.create({
      data: {
        conversationId: ctx.conversationId,
        userId: actor.userId,
        clientId: p.clientId,
        kind: p.kind,
        summary: p.summary,
        payload: p.details as never,
      },
      select: { id: true },
    } as Parameters<typeof tx.aiAction.create>[0]);
    const id = (row as { id: string }).id;
    return {
      ok: true,
      actionId: id,
      content: JSON.stringify({
        proposalId: id,
        status: 'waiting for the coach to confirm',
        summary: p.summary,
        note: 'Nothing has changed yet. Tell the coach what you proposed; a Confirm button is shown under your answer.',
      }),
    };
  } catch (err) {
    if (err instanceof ProposalError) return { ok: false, content: err.message };
    if (err instanceof DomainError && err.code === 'FORBIDDEN') {
      return { ok: false, content: 'Your role cannot make this change.' };
    }
    throw err;
  }
}

// ---------------------------------------------------------------- reading and deciding

const view = (r: {
  id: string;
  messageId: string | null;
  kind: string;
  summary: string;
  payload: unknown;
  status: string;
  error: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}): AiActionView => ({
  id: r.id,
  messageId: r.messageId,
  kind: r.kind as AiActionKind,
  summary: r.summary,
  details: r.payload,
  status: r.status as AiActionStatus,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

const SELECT = {
  id: true,
  messageId: true,
  kind: true,
  summary: true,
  payload: true,
  status: true,
  error: true,
  createdAt: true,
  decidedAt: true,
} as const;

/** The caller's proposals in one of their conversations. */
export async function listAiActions(
  tx: TenantTx,
  actor: ActorContext,
  conversationId: string,
): Promise<AiActionView[]> {
  assertCan(actor, 'assistant:use');
  if (!isUuid(conversationId)) return [];
  const rows = await tx.aiAction.findMany({
    where: { conversationId, userId: actor.userId, organizationId: actor.orgId },
    orderBy: { createdAt: 'asc' },
    select: SELECT,
  });
  return rows.map(view);
}

/** Ties proposals made during a turn to the assistant message that answered it. */
export async function linkAiActions(
  tx: TenantTx,
  actor: ActorContext,
  ids: string[],
  messageId: string,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.aiAction.updateMany({
    where: { id: { in: ids }, userId: actor.userId, messageId: null },
    data: { messageId },
  });
}

const notFound = () => new DomainError('NOT_FOUND', 'Proposal not found.');

async function claim(tx: TenantTx, actor: ActorContext, id: string, now: Date) {
  assertCan(actor, 'assistant:use');
  if (!isUuid(id)) throw notFound();
  const row = await tx.aiAction.findFirst({
    where: { id, userId: actor.userId, organizationId: actor.orgId },
    select: { ...SELECT, clientId: true },
  });
  if (!row) throw notFound();
  if (row.status !== 'proposed') {
    throw new DomainError('CONFLICT', `This proposal was already ${row.status}.`);
  }
  if (now.getTime() - row.createdAt.getTime() > AI_ACTION_TTL_MS) {
    await tx.aiAction.updateMany({
      where: { id, status: 'proposed' },
      data: { status: 'expired', decidedAt: now },
    });
    throw new DomainError(
      'CONFLICT',
      'This proposal is more than a day old. Ask the assistant again.',
    );
  }
  return row;
}

/**
 * Applies a proposal for the coach who asked for it. Runs the same domain functions as the screens; any check they
 * fail rolls the whole change back (the caller records the failure in a new transaction with `markAiActionFailed`).
 */
export async function applyAiAction(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { now?: Date; requestId?: string } = {},
): Promise<AiActionView> {
  const now = opts.now ?? new Date();
  const row = await claim(tx, actor, id, now);
  const { count } = await tx.aiAction.updateMany({
    where: { id, status: 'proposed' },
    data: { status: 'applied', decidedAt: now },
  });
  if (count === 0) throw new DomainError('CONFLICT', 'This proposal was already decided.');
  const d = row.payload as Input;
  let result: unknown;
  switch (row.kind as AiActionKind) {
    case 'assign_program':
      result = await assignProgram(
        tx,
        actor,
        {
          clientId: String(d.clientId),
          templateProgramId: String(d.templateProgramId),
          startLocalDate: String(d.startDate),
          weekdays: d.weekdays as (1 | 2 | 3 | 4 | 5 | 6 | 7)[],
          // The card showed the replacement and the start; the coach's Confirm is that confirmation.
          readinessConfirmed: true,
          confirmReplace: true,
        },
        { requestId: opts.requestId, now },
      );
      break;
    case 'set_nutrition_targets':
      await setNutritionTarget(
        tx,
        actor,
        String(d.clientId),
        {
          ...(d.targets as object),
          ...(d.effectiveFrom ? { effectiveFrom: d.effectiveFrom } : {}),
        },
        { requestId: opts.requestId },
      );
      result = { targets: d.targets };
      break;
    case 'meal_plan': {
      const saved = await saveMealPlan(
        tx,
        actor,
        { title: d.title, notes: d.notes, days: d.days },
        { requestId: opts.requestId },
      );
      await setClientMealPlan(tx, actor, String(d.clientId), saved.id, {
        requestId: opts.requestId,
        now,
      });
      if (d.alsoSetTargets === true) {
        await setNutritionTarget(tx, actor, String(d.clientId), d.targets as Input, {
          requestId: opts.requestId,
        });
      }
      result = { mealPlanId: saved.id };
      break;
    }
    case 'assign_meal_plan':
      await setClientMealPlan(tx, actor, String(d.clientId), d.mealPlanId, {
        requestId: opts.requestId,
        now,
      });
      result = { mealPlanId: d.mealPlanId };
      break;
  }
  await tx.aiAction.updateMany({ where: { id }, data: { result: (result ?? null) as never } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: row.clientId ?? id,
    action: 'assistant.action_applied',
    metadata: { kind: row.kind, proposalId: id },
    requestId: opts.requestId,
  });
  return view({ ...row, status: 'applied', decidedAt: now });
}

export async function cancelAiAction(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { now?: Date } = {},
): Promise<AiActionView> {
  const now = opts.now ?? new Date();
  const row = await claim(tx, actor, id, now);
  await tx.aiAction.updateMany({
    where: { id, status: 'proposed' },
    data: { status: 'cancelled', decidedAt: now },
  });
  return view({ ...row, status: 'cancelled', decidedAt: now });
}

/** Records why applying failed (the failed attempt itself was rolled back). */
export async function markAiActionFailed(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  message: string,
  opts: { now?: Date } = {},
): Promise<void> {
  if (!isUuid(id)) return;
  await tx.aiAction.updateMany({
    where: { id, userId: actor.userId, status: 'proposed' },
    data: { status: 'failed', error: message.slice(0, 500), decidedAt: opts.now ?? new Date() },
  });
}

/** Whether this actor can be offered the action tools at all. */
export const canUseAssistantActions = (actor: ActorContext) =>
  can(actor, 'assignment:write') || can(actor, 'nutrition:manage');
