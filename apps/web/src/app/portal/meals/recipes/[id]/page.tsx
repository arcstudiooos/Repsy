import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getRecipe } from '@repsy/core';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Recipe | Repsy' };

/** PRD G9: a recipe from the client's meal plan. */
export default async function PortalRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let recipe;
  try {
    recipe = await withPortalTenant((tx, actor) => getRecipe(tx, actor, id));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const per = [
    recipe.calories !== null && `${recipe.calories} kcal`,
    recipe.proteinG !== null && `${recipe.proteinG} g protein`,
    recipe.carbsG !== null && `${recipe.carbsG} g carbs`,
    recipe.fatG !== null && `${recipe.fatG} g fat`,
  ].filter(Boolean);
  return (
    <>
      <Link
        href="/portal/meals"
        className="mb-4 inline-block text-accent underline underline-offset-4"
      >
        Back to your meal plan
      </Link>
      <h1 className="mb-2 text-2xl font-semibold break-words md:text-3xl">{recipe.title}</h1>
      <p className="mb-6 text-secondary">
        Makes {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}
        {per.length > 0 && `. Per serving: ${per.join(', ')}`}
      </p>
      <div className="flex flex-col gap-6">
        {recipe.photoMediaId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/v1/media/${recipe.photoMediaId}`}
            alt={recipe.title}
            className="max-h-80 w-full max-w-md rounded-card object-cover"
          />
        )}
        {recipe.ingredients.length > 0 && (
          <section aria-labelledby="ing-h">
            <h2 id="ing-h" className="mb-2 text-lg font-semibold">
              Ingredients
            </h2>
            <ul className="list-disc pl-6">
              {recipe.ingredients.map((i, n) => (
                <li key={n} className="break-words">
                  {i.amount !== null && `${i.amount}${i.unit ? ` ${i.unit}` : ''} `}
                  {i.name}
                </li>
              ))}
            </ul>
          </section>
        )}
        {recipe.steps && (
          <section aria-labelledby="steps-h">
            <h2 id="steps-h" className="mb-2 text-lg font-semibold">
              Steps
            </h2>
            <p className="break-words whitespace-pre-line">{recipe.steps}</p>
          </section>
        )}
      </div>
    </>
  );
}
