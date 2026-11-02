import Link from 'next/link';
import type { MealPlanView, ShoppingItem } from '@kinetic/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingList } from './ShoppingList';

const macros = (o: { calories: number | null; proteinG: number | null }) =>
  [o.calories !== null && `${o.calories} kcal`, o.proteinG !== null && `${o.proteinG} g protein`]
    .filter(Boolean)
    .join(' · ');

/** PRD G8: a meal plan, day by day; each meal lists its options ("or"), with the day's totals from the first ones. */
export function MealPlanDisplay({
  plan,
  shopping,
  recipeHref,
}: {
  plan: MealPlanView;
  shopping: ShoppingItem[];
  recipeHref: (id: string) => string;
}) {
  return (
    <div className="flex flex-col gap-6">
      {plan.notes && <p className="break-words whitespace-pre-line">{plan.notes}</p>}
      {plan.pdfMediaId && (
        <a
          href={`/api/v1/media/${plan.pdfMediaId}`}
          className="self-start text-accent underline underline-offset-4"
        >
          Download the plan (PDF)
        </a>
      )}
      {plan.days.map((d, di) => (
        <Card key={di}>
          <CardHeader>
            <CardTitle as="h2" className="break-words">
              {d.name}
            </CardTitle>
            {macros(d.totals) && (
              <p className="text-sm text-secondary">About {macros(d.totals)} (first options)</p>
            )}
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              {d.meals.map((m, mi) => (
                <div key={mi}>
                  <dt className="font-semibold break-words">{m.name}</dt>
                  <dd>
                    <ul className="flex flex-col gap-1">
                      {m.options.map((o, oi) => (
                        <li key={oi} className="break-words">
                          {oi > 0 && <span className="text-secondary">or </span>}
                          {o.recipeId ? (
                            <Link
                              href={recipeHref(o.recipeId)}
                              className="text-accent underline underline-offset-4"
                            >
                              {o.title}
                            </Link>
                          ) : (
                            o.title
                          )}
                          {o.servings !== null && o.servings !== 1 && ` × ${o.servings}`}
                          {macros(o) && (
                            <span className="text-sm text-secondary"> · {macros(o)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
      {shopping.length > 0 && <ShoppingList items={shopping} />}
    </div>
  );
}
