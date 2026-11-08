'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { Ingredient, RecipeView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { uploadMedia } from '@/lib/media-upload';

type Row = { name: string; amount: string; unit: string };
const MACROS = [
  ['calories', 'Calories (kcal)'],
  ['proteinG', 'Protein (g)'],
  ['carbsG', 'Carbs (g)'],
  ['fatG', 'Fat (g)'],
] as const;
const TEXTAREA = 'rounded-control border border-input-border bg-surface px-3 py-2 text-base';

/** PRD G9: a recipe's ingredients (for all servings), steps, macros per serving and photo. */
export function RecipeEditor({ recipe }: { recipe: RecipeView | null }) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [servings, setServings] = useState(String(recipe?.servings ?? 1));
  const [rows, setRows] = useState<Row[]>(
    recipe?.ingredients.length
      ? recipe.ingredients.map((i: Ingredient) => ({
          name: i.name,
          amount: i.amount === null ? '' : String(i.amount),
          unit: i.unit,
        }))
      : [{ name: '', amount: '', unit: '' }],
  );
  const [steps, setSteps] = useState(recipe?.steps ?? '');
  const [m, setM] = useState<Record<string, string>>(
    Object.fromEntries(
      MACROS.map(([k]) => [k, recipe?.[k] === null || !recipe ? '' : String(recipe[k])]),
    ),
  );
  const [photoId, setPhotoId] = useState<string | null>(recipe?.photoMediaId ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Row>) =>
    setRows((xs) => xs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      title,
      servings: Number(servings),
      steps,
      ingredients: rows
        .filter((r) => r.name.trim() || r.amount.trim())
        .map((r) => ({ name: r.name, amount: num(r.amount), unit: r.unit })),
      ...Object.fromEntries(MACROS.map(([k]) => [k, num(m[k] ?? '')])),
      photoMediaId: photoId,
    };
    const res = await call<{ id: string }>(
      recipe ? 'PUT' : 'POST',
      recipe ? `/api/v1/recipes/${recipe.id}` : '/api/v1/recipes',
      body,
    );
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors({
        ...Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
        form: Object.keys(fe).length ? 'Check the highlighted fields.' : res.message,
      });
      return;
    }
    toast.success('Recipe saved');
    router.push('/app/meal-plans');
    router.refresh();
  }
  const err = (k: string) =>
    errors[k] ? <p className="text-sm text-danger">{errors[k]}</p> : null;

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={`${uid}-title`} className="text-sm font-medium">
        Recipe name
      </label>
      <Input
        id={`${uid}-title`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      {err('title')}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-servings`} className="text-sm font-medium">
          Servings it makes
        </label>
        <Input
          id={`${uid}-servings`}
          type="number"
          min={1}
          max={50}
          className="w-28"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
        />
        {err('servings')}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Ingredients (for all servings)</legend>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={`${uid}-${i}-name`} className="text-sm font-medium">
                Ingredient {i + 1}
              </label>
              <Input
                id={`${uid}-${i}-name`}
                value={r.name}
                maxLength={80}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-${i}-amount`} className="text-sm font-medium">
                Amount {i + 1}
              </label>
              <Input
                id={`${uid}-${i}-amount`}
                inputMode="decimal"
                className="w-24"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-${i}-unit`} className="text-sm font-medium">
                Unit {i + 1}
              </label>
              <Input
                id={`${uid}-${i}-unit`}
                className="w-24"
                maxLength={20}
                placeholder="g"
                value={r.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ingredient ${i + 1}`}
              onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
            {err(`ingredients.${i}.name`)}
            {err(`ingredients.${i}.amount`)}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={rows.length >= 40}
            onClick={() => setRows((xs) => [...xs, { name: '', amount: '', unit: '' }])}
          >
            Add an ingredient
          </Button>
        </div>
      </fieldset>
      <label htmlFor={`${uid}-steps`} className="text-sm font-medium">
        Steps
      </label>
      <textarea
        id={`${uid}-steps`}
        rows={6}
        maxLength={10000}
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
        className={TEXTAREA}
      />
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 font-semibold">Per serving</legend>
        {MACROS.map(([k, l]) => (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={`${uid}-${k}`} className="text-sm font-medium">
              {l}
            </label>
            <Input
              id={`${uid}-${k}`}
              type="number"
              min={0}
              className="w-28"
              value={m[k] ?? ''}
              onChange={(e) => setM((x) => ({ ...x, [k]: e.target.value }))}
            />
            {err(k)}
          </div>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}-photo`} className="text-sm font-medium">
          Photo (optional)
        </label>
        {photoId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/v1/media/${photoId}`}
            alt={`${title || 'Recipe'} photo`}
            className="h-32 w-auto self-start rounded-control object-cover"
          />
        )}
        <input
          id={`${uid}-photo`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="max-w-full text-base"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            const up = await uploadMedia('nutrition', f);
            setBusy(false);
            if (up.ok) setPhotoId(up.id);
            else setErrors((x) => ({ ...x, photo: up.message }));
          }}
        />
        {err('photo')}
        {photoId && (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoId(null)}>
              Remove photo
            </Button>
          </div>
        )}
      </div>
      <div>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          Save recipe
        </Button>
      </div>
      {errors.form && (
        <p role="alert" className="text-danger">
          {errors.form}
        </p>
      )}
    </div>
  );
}
