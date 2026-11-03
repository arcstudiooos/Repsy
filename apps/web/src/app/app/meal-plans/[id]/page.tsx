import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUuid, listMealPlans, listRecipes } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { ArchiveButton } from '../ArchiveButton';
import { MealPlanEditor } from '../MealPlanEditor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Meal plan | Kinetic' };

export default async function MealPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const data = await withServerTenant(async (tx, actor) => ({
    plan: id === 'new' ? null : ((await listMealPlans(tx, actor)).find((p) => p.id === id) ?? null),
    recipes: (await listRecipes(tx, actor)).map((r) => ({ id: r.id, title: r.title })),
  }));
  if (id !== 'new' && !data.plan) notFound();
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">
          {data.plan ? data.plan.title : 'New meal plan'}
        </h1>
        {data.plan && (
          <ArchiveButton
            path={`/api/v1/meal-plans/${data.plan.id}`}
            what="meal plan"
            name={data.plan.title}
          />
        )}
      </div>
      <MealPlanEditor plan={data.plan} recipes={data.recipes} />
    </>
  );
}
