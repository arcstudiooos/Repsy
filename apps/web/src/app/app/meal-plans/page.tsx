import type { Metadata } from 'next';
import Link from 'next/link';
import { listMealPlans, listRecipes } from '@repsy/core';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Meal plans | Repsy' };

const kcal = (v: number | null) => (v === null ? '' : ` · ${v} kcal`);

/** PRD G8, G9: the workspace's meal plans and recipes. Give a client a plan from their Nutrition tab. */
export default async function MealPlansPage() {
  const { plans, recipes } = await withServerTenant(async (tx, actor) => ({
    plans: await listMealPlans(tx, actor),
    recipes: await listRecipes(tx, actor),
  }));
  return (
    <>
      <h1 className="mb-2 text-h1 font-semibold md:text-display">Meal plans</h1>
      <p className="mb-6 text-secondary">
        Build plans from your recipes, with swap options for each meal. Give a client a plan from
        their Nutrition tab; they get a shopping list with it.
      </p>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="plans-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plans-h" className="text-xl font-semibold">
              Plans
            </h2>
            <Link href="/app/meal-plans/new" className={buttonVariants({ variant: 'default' })}>
              New meal plan
            </Link>
          </div>
          {plans.length === 0 ? (
            <p className="text-secondary">No meal plans yet.</p>
          ) : (
            <ul aria-label="Meal plans" className="flex flex-col gap-2">
              {plans.map((p) => (
                <li key={p.id} className="rounded-card bg-surface p-4 shadow-card">
                  <Link
                    href={`/app/meal-plans/${p.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="text-sm text-secondary">
                    {p.days.length
                      ? `${p.days.length} ${p.days.length === 1 ? 'day' : 'days'}`
                      : 'PDF'}
                    {p.pdfMediaId && p.days.length ? ' + PDF' : ''} · {p.assigned}{' '}
                    {p.assigned === 1 ? 'client' : 'clients'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="recipes-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="recipes-h" className="text-xl font-semibold">
              Recipes
            </h2>
            <Link
              href="/app/meal-plans/recipes/new"
              className={buttonVariants({ variant: 'secondary' })}
            >
              New recipe
            </Link>
          </div>
          {recipes.length === 0 ? (
            <p className="text-secondary">No recipes yet.</p>
          ) : (
            <ul aria-label="Recipes" className="flex flex-col gap-2">
              {recipes.map((r) => (
                <li key={r.id} className="rounded-card bg-surface p-4 shadow-card">
                  <Link
                    href={`/app/meal-plans/recipes/${r.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {r.title}
                  </Link>
                  <p className="text-sm text-secondary">
                    {r.servings} {r.servings === 1 ? 'serving' : 'servings'}
                    {kcal(r.calories)} per serving
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
