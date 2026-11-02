import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { eraseMedia, ownMedia } from '../media/media';
import { isUuid } from '../uuid';

/**
 * PRD G8, G9: recipes and meal plans. A recipe lists ingredients (for all its servings), steps and macros per
 * serving, with an optional photo. A meal plan is days x meals; each meal has one or more options to swap between
 * (a recipe at some servings, or a described option with its own macros), or the plan is an uploaded PDF. A client
 * has one plan at a time and gets a shopping list built from the first option of every meal.
 */
export const RECIPES_MAX = 500;
export const MEAL_PLANS_MAX = 100;
export const DAYS_MAX = 14;
export const MEALS_MAX = 8;
export const OPTIONS_MAX = 5;
export const INGREDIENTS_MAX = 40;

export interface Ingredient {
  name: string;
  amount: number | null;
  unit: string;
}

export interface Macros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface RecipeView extends Macros {
  id: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  steps: string;
  photoMediaId: string | null;
}

export interface MealOptionInput extends Partial<Macros> {
  recipeId?: string;
  servings?: number;
  text?: string;
}

export interface MealOptionView extends Macros {
  recipeId: string | null;
  servings: number | null;
  /** The recipe's title, or the described option. */
  title: string;
}

export interface MealPlanDay {
  name: string;
  meals: { name: string; options: MealOptionView[] }[];
  /** From the first option of each meal; null where none of them say. */
  totals: Macros;
}

export interface MealPlanView {
  id: string;
  title: string;
  notes: string;
  pdfMediaId: string | null;
  days: MealPlanDay[];
  assigned: number;
}

export interface ShoppingItem {
  name: string;
  amount: number | null;
  unit: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function macro(v: unknown, field: string, max: number): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max)
    throw invalid(field, `Use a whole number from 0 to ${max}.`);
  return n;
}
const macros = (o: Record<string, unknown>, at: string): Macros => ({
  calories: macro(o.calories, `${at}calories`, 5000),
  proteinG: macro(o.proteinG, `${at}proteinG`, 500),
  carbsG: macro(o.carbsG, `${at}carbsG`, 1000),
  fatG: macro(o.fatG, `${at}fatG`, 500),
});
const MACRO_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;

// ---------------------------------------------------------------- recipes (G9)

function cleanRecipe(input: Record<string, unknown>) {
  const title = text(input.title);
  if (title.length < 1 || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const servings = Number(input.servings ?? 1);
  if (!Number.isInteger(servings) || servings < 1 || servings > 50) {
    throw invalid('servings', 'Use 1-50 servings.');
  }
  const steps = text(input.steps);
  if (steps.length > 10_000) throw invalid('steps', 'Use at most 10,000 characters.');
  const raw = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (raw.length > INGREDIENTS_MAX) {
    throw invalid('ingredients', `Use at most ${INGREDIENTS_MAX} ingredients.`);
  }
  const ingredients: Ingredient[] = raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = text(o.name);
    if (name.length < 1 || name.length > 80) {
      throw invalid(`ingredients.${i}.name`, `Name ingredient ${i + 1}.`);
    }
    let amount: number | null = null;
    if (o.amount !== undefined && o.amount !== null && o.amount !== '') {
      amount = Number(o.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
        throw invalid(`ingredients.${i}.amount`, 'Use a positive amount.');
      }
      amount = Math.round(amount * 100) / 100;
    }
    const unit = text(o.unit);
    if (unit.length > 20) throw invalid(`ingredients.${i}.unit`, 'Use a short unit (g, ml, cup).');
    return { name, amount, unit };
  });
  return { title, servings, steps, ingredients, ...macros(input, '') };
}

const RECIPE_SELECT = {
  id: true,
  title: true,
  servings: true,
  ingredientsJson: true,
  steps: true,
  calories: true,
  proteinG: true,
  carbsG: true,
  fatG: true,
  photoMediaId: true,
} as const;
type RecipeRow = {
  id: string;
  title: string;
  servings: number;
  ingredientsJson: unknown;
  steps: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  photoMediaId: string | null;
};
const recipeView = (r: RecipeRow): RecipeView => ({
  id: r.id,
  title: r.title,
  servings: r.servings,
  ingredients: (Array.isArray(r.ingredientsJson) ? r.ingredientsJson : []) as Ingredient[],
  steps: r.steps,
  calories: r.calories,
  proteinG: r.proteinG,
  carbsG: r.carbsG,
  fatG: r.fatG,
  photoMediaId: r.photoMediaId,
});

export async function listRecipes(tx: TenantTx, actor: ActorContext): Promise<RecipeView[]> {
  assertCan(actor, 'nutrition:manage');
  const rows = await tx.recipe.findMany({
    where: { archivedAt: null },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: RECIPE_SELECT,
  });
  return rows.map(recipeView);
}

/** Creates a recipe, or replaces one when `input.id` is set. A new photo replaces (and erases) the old one. */
export async function saveRecipe(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'nutrition:manage');
  const r = cleanRecipe(input);
  const photo =
    input.photoMediaId === undefined
      ? undefined
      : input.photoMediaId === null
        ? null
        : await ownMedia(tx, actor, input.photoMediaId, 'nutrition', null);
  const data = {
    title: r.title,
    servings: r.servings,
    steps: r.steps,
    ingredientsJson: r.ingredients as never,
    calories: r.calories,
    proteinG: r.proteinG,
    carbsG: r.carbsG,
    fatG: r.fatG,
    ...(photo !== undefined ? { photoMediaId: photo } : {}),
  };
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const existing = await tx.recipe.findFirst({
      where: { id: input.id, archivedAt: null },
      select: { id: true, photoMediaId: true },
    });
    if (!existing) throw notFound();
    await tx.recipe.update({ where: { id: existing.id }, data });
    if (photo !== undefined && existing.photoMediaId && existing.photoMediaId !== photo) {
      await eraseMedia(tx, [existing.photoMediaId]);
    }
    id = existing.id;
  } else {
    if ((await tx.recipe.count({ where: { archivedAt: null } })) >= RECIPES_MAX) {
      throw invalid('title', `A workspace can have at most ${RECIPES_MAX} recipes.`);
    }
    const row = await tx.recipe.create({
      data: { ...data, createdBy: actor.userId },
      select: { id: true },
    } as Parameters<typeof tx.recipe.create>[0]);
    id = (row as { id: string }).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'recipe',
    objectId: id,
    action: input.id === undefined ? 'recipe.created' : 'recipe.updated',
    requestId: opts.requestId,
  });
  return { id };
}

/** Archives a recipe. Plans that use it keep showing it, so clients following them are not left with a gap. */
export async function archiveRecipe(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'nutrition:manage');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.recipe.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'recipe',
    objectId: id,
    action: 'recipe.archived',
    requestId: opts.requestId,
  });
}

/** One recipe. A client may open only the recipes in their current meal plan. */
export async function getRecipe(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
): Promise<RecipeView> {
  assertCan(actor, 'nutrition:read');
  if (!isUuid(id)) throw notFound();
  if (actor.role === 'client') {
    const plan = await openPlan(tx, actor.clientId ?? '');
    if (!plan || !recipeIdsOf(plan.daysJson).has(id)) throw notFound();
  }
  const row = await tx.recipe.findFirst({ where: { id }, select: RECIPE_SELECT });
  if (!row) throw notFound();
  return recipeView(row);
}

// ---------------------------------------------------------------- meal plans (G8)

interface StoredOption extends Partial<Macros> {
  recipeId?: string;
  servings?: number;
  text?: string;
}
interface StoredDay {
  name: string;
  meals: { name: string; options: StoredOption[] }[];
}

function recipeIdsOf(daysJson: unknown): Set<string> {
  const ids = new Set<string>();
  for (const d of (Array.isArray(daysJson) ? daysJson : []) as StoredDay[]) {
    for (const m of d.meals ?? [])
      for (const o of m.options ?? []) if (o.recipeId) ids.add(o.recipeId);
  }
  return ids;
}

async function cleanDays(tx: TenantTx, input: unknown): Promise<StoredDay[]> {
  const days = Array.isArray(input) ? input : [];
  if (days.length > DAYS_MAX) throw invalid('days', `Use at most ${DAYS_MAX} days.`);
  const out: StoredDay[] = days.map((rd, di) => {
    const d = (rd ?? {}) as Record<string, unknown>;
    const name = text(d.name) || `Day ${di + 1}`;
    if (name.length > 40) throw invalid(`days.${di}.name`, 'Use at most 40 characters.');
    const meals = Array.isArray(d.meals) ? d.meals : [];
    if (meals.length < 1 || meals.length > MEALS_MAX) {
      throw invalid(`days.${di}.meals`, `Give ${name} 1-${MEALS_MAX} meals.`);
    }
    return {
      name,
      meals: meals.map((rm, mi) => {
        const m = (rm ?? {}) as Record<string, unknown>;
        const at = `days.${di}.meals.${mi}`;
        const mealName = text(m.name);
        if (mealName.length < 1 || mealName.length > 40)
          throw invalid(`${at}.name`, 'Name the meal.');
        const options = Array.isArray(m.options) ? m.options : [];
        if (options.length < 1 || options.length > OPTIONS_MAX) {
          throw invalid(`${at}.options`, `Give ${mealName} 1-${OPTIONS_MAX} options.`);
        }
        return {
          name: mealName,
          options: options.map((ro, oi) => {
            const o = (ro ?? {}) as Record<string, unknown>;
            const oat = `${at}.options.${oi}`;
            if (o.recipeId !== undefined && o.recipeId !== null && o.recipeId !== '') {
              if (!isUuid(o.recipeId)) throw invalid(`${oat}.recipeId`, 'Pick a recipe.');
              const servings = Number(o.servings ?? 1);
              if (!Number.isFinite(servings) || servings < 0.25 || servings > 10) {
                throw invalid(`${oat}.servings`, 'Use 0.25-10 servings.');
              }
              return { recipeId: o.recipeId, servings: Math.round(servings * 100) / 100 };
            }
            const t = text(o.text);
            if (t.length < 1 || t.length > 200)
              throw invalid(`${oat}.text`, 'Describe the option or pick a recipe.');
            const mm = macros(o, `${oat}.`);
            return {
              text: t,
              ...Object.fromEntries(
                MACRO_KEYS.flatMap((k) => (mm[k] === null ? [] : [[k, mm[k]]])),
              ),
            };
          }),
        };
      }),
    };
  });
  const ids = recipeIdsOf(out);
  if (ids.size > 0) {
    const found = await tx.recipe.count({ where: { id: { in: [...ids] }, archivedAt: null } });
    if (found !== ids.size) throw invalid('days', 'One of these recipes no longer exists.');
  }
  return out;
}

async function plansView(
  tx: TenantTx,
  rows: {
    id: string;
    title: string;
    notes: string;
    pdfMediaId: string | null;
    daysJson: unknown;
    _count?: { assigned: number };
  }[],
): Promise<MealPlanView[]> {
  const ids = new Set(rows.flatMap((r) => [...recipeIdsOf(r.daysJson)]));
  const recipes = new Map(
    (
      await tx.recipe.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, title: true, calories: true, proteinG: true, carbsG: true, fatG: true },
      })
    ).map((r) => [r.id, r]),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    pdfMediaId: r.pdfMediaId,
    assigned: r._count?.assigned ?? 0,
    days: ((Array.isArray(r.daysJson) ? r.daysJson : []) as StoredDay[]).map((d) => {
      const meals = d.meals.map((m) => ({
        name: m.name,
        options: m.options.map((o): MealOptionView => {
          if (o.recipeId) {
            const rec = recipes.get(o.recipeId);
            const s = o.servings ?? 1;
            const scale = (v: number | null | undefined) =>
              v === null || v === undefined ? null : Math.round(v * s);
            return {
              recipeId: o.recipeId,
              servings: s,
              title: rec?.title ?? 'Recipe',
              calories: scale(rec?.calories),
              proteinG: scale(rec?.proteinG),
              carbsG: scale(rec?.carbsG),
              fatG: scale(rec?.fatG),
            };
          }
          return {
            recipeId: null,
            servings: null,
            title: o.text ?? '',
            calories: o.calories ?? null,
            proteinG: o.proteinG ?? null,
            carbsG: o.carbsG ?? null,
            fatG: o.fatG ?? null,
          };
        }),
      }));
      const totals = Object.fromEntries(
        MACRO_KEYS.map((k) => {
          const vals = meals.map((m) => m.options[0]?.[k] ?? null);
          return [
            k,
            vals.every((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0),
          ];
        }),
      ) as unknown as Macros;
      return { name: d.name, meals, totals };
    }),
  }));
}

const PLAN_SELECT = {
  id: true,
  title: true,
  notes: true,
  pdfMediaId: true,
  daysJson: true,
} as const;

export async function listMealPlans(tx: TenantTx, actor: ActorContext): Promise<MealPlanView[]> {
  assertCan(actor, 'nutrition:manage');
  const rows = await tx.mealPlan.findMany({
    where: { archivedAt: null },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: { ...PLAN_SELECT, _count: { select: { assigned: { where: { endedAt: null } } } } },
  });
  return plansView(tx, rows);
}

export async function saveMealPlan(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'nutrition:manage');
  const title = text(input.title);
  if (title.length < 1 || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const notes = text(input.notes);
  if (notes.length > 4000) throw invalid('notes', 'Use at most 4000 characters.');
  const days = await cleanDays(tx, input.days);
  const pdf =
    input.pdfMediaId === undefined || input.pdfMediaId === null || input.pdfMediaId === ''
      ? null
      : await ownMedia(tx, actor, input.pdfMediaId, 'nutrition', null);
  if (days.length === 0 && pdf === null)
    throw invalid('days', 'Add a day, or upload the plan as a PDF.');
  const data = { title, notes, daysJson: days as never, pdfMediaId: pdf };
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const existing = await tx.mealPlan.findFirst({
      where: { id: input.id, archivedAt: null },
      select: { id: true, pdfMediaId: true },
    });
    if (!existing) throw notFound();
    await tx.mealPlan.update({ where: { id: existing.id }, data });
    if (existing.pdfMediaId && existing.pdfMediaId !== pdf)
      await eraseMedia(tx, [existing.pdfMediaId]);
    id = existing.id;
  } else {
    if ((await tx.mealPlan.count({ where: { archivedAt: null } })) >= MEAL_PLANS_MAX) {
      throw invalid('title', `A workspace can have at most ${MEAL_PLANS_MAX} meal plans.`);
    }
    const row = await tx.mealPlan.create({
      data: { ...data, createdBy: actor.userId },
      select: { id: true },
    } as Parameters<typeof tx.mealPlan.create>[0]);
    id = (row as { id: string }).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'meal_plan',
    objectId: id,
    action: input.id === undefined ? 'meal_plan.created' : 'meal_plan.updated',
    requestId: opts.requestId,
  });
  return { id };
}

/** Archives a plan; clients on it stop seeing it. */
export async function archiveMealPlan(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'nutrition:manage');
  if (!isUuid(id)) throw notFound();
  const now = opts.now ?? new Date();
  const { count } = await tx.mealPlan.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: now },
  });
  if (count === 0) throw notFound();
  await tx.clientMealPlan.updateMany({
    where: { mealPlanId: id, endedAt: null },
    data: { endedAt: now },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'meal_plan',
    objectId: id,
    action: 'meal_plan.archived',
    requestId: opts.requestId,
  });
}

/** Gives a client a plan, replacing their current one; `mealPlanId: null` takes it away. */
export async function setClientMealPlan(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  mealPlanId: unknown,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'nutrition:manage');
  if (!isUuid(clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId, status: { not: 'archived' } },
    select: { id: true },
  });
  if (!client) throw notFound();
  let planId: string | null = null;
  if (mealPlanId !== null) {
    if (!isUuid(mealPlanId)) throw invalid('mealPlanId', 'Pick a meal plan.');
    const plan = await tx.mealPlan.findFirst({
      where: { id: mealPlanId, archivedAt: null },
      select: { id: true },
    });
    if (!plan) throw invalid('mealPlanId', 'That meal plan no longer exists.');
    planId = plan.id;
  }
  const now = opts.now ?? new Date();
  const current = await tx.clientMealPlan.findFirst({
    where: { clientId: client.id, endedAt: null },
    select: { id: true, mealPlanId: true },
  });
  if (current?.mealPlanId === planId) return;
  if (current)
    await tx.clientMealPlan.update({ where: { id: current.id }, data: { endedAt: now } });
  if (planId) {
    await tx.clientMealPlan.create({
      data: { clientId: client.id, mealPlanId: planId },
    } as Parameters<typeof tx.clientMealPlan.create>[0]);
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: planId ? 'meal_plan.assigned' : 'meal_plan.removed',
    metadata: planId ? { mealPlanId: planId } : undefined,
    requestId: opts.requestId,
  });
}

async function openPlan(tx: TenantTx, clientId: string) {
  if (!isUuid(clientId)) return null;
  const row = await tx.clientMealPlan.findFirst({
    where: { clientId, endedAt: null, mealPlan: { archivedAt: null } },
    select: { mealPlan: { select: PLAN_SELECT } },
  });
  return row?.mealPlan ?? null;
}

/** Sums the ingredients of the first option of every meal, scaled to its servings (same name and unit add up). */
export function shoppingList(
  days: { meals: { options: { recipeId?: string | null; servings?: number | null }[] }[] }[],
  recipes: Map<string, { servings: number; ingredients: Ingredient[] }>,
): ShoppingItem[] {
  const items = new Map<string, ShoppingItem>();
  for (const d of days) {
    for (const m of d.meals) {
      const o = m.options[0];
      const rec = o?.recipeId ? recipes.get(o.recipeId) : undefined;
      if (!rec) continue;
      const factor = (o!.servings ?? 1) / rec.servings;
      for (const ing of rec.ingredients) {
        const key = `${ing.name.toLowerCase()}|${ing.unit.toLowerCase()}`;
        const item = items.get(key) ?? { name: ing.name, amount: null, unit: ing.unit };
        if (ing.amount !== null) {
          item.amount = Math.round(((item.amount ?? 0) + ing.amount * factor) * 100) / 100;
        }
        items.set(key, item);
      }
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A client's current plan with its shopping list (a client reads their own); null when they have none. */
export async function clientMealPlan(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: string,
): Promise<{ plan: MealPlanView; shopping: ShoppingItem[] } | null> {
  assertCan(actor, 'nutrition:read');
  const id = actor.role === 'client' ? actor.clientId : clientId;
  if (!isUuid(id)) throw notFound();
  const row = await openPlan(tx, id);
  if (!row) return null;
  const [plan] = await plansView(tx, [row]);
  const ids = [...recipeIdsOf(row.daysJson)];
  const recipes = new Map(
    (
      await tx.recipe.findMany({
        where: { id: { in: ids } },
        select: { id: true, servings: true, ingredientsJson: true },
      })
    ).map((r) => [
      r.id,
      {
        servings: r.servings,
        ingredients: (Array.isArray(r.ingredientsJson)
          ? r.ingredientsJson
          : []) as unknown as Ingredient[],
      },
    ]),
  );
  return { plan: plan!, shopping: shoppingList(plan!.days, recipes) };
}
