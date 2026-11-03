import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUuid, listRecipes } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { ArchiveButton } from '../../ArchiveButton';
import { RecipeEditor } from '../../RecipeEditor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Recipe | Repsy' };

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const recipe =
    id === 'new'
      ? null
      : await withServerTenant(
          async (tx, actor) => (await listRecipes(tx, actor)).find((r) => r.id === id) ?? null,
        );
  if (id !== 'new' && !recipe) notFound();
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">
          {recipe ? recipe.title : 'New recipe'}
        </h1>
        {recipe && (
          <ArchiveButton path={`/api/v1/recipes/${recipe.id}`} what="recipe" name={recipe.title} />
        )}
      </div>
      <RecipeEditor recipe={recipe} />
    </>
  );
}
