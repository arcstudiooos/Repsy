'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { MealPlanView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { uploadMedia } from '@/lib/media-upload';

interface Opt {
  kind: 'recipe' | 'text';
  recipeId: string;
  servings: string;
  text: string;
  calories: string;
  proteinG: string;
}
interface Meal {
  name: string;
  options: Opt[];
}
interface Day {
  name: string;
  meals: Meal[];
}

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const blankOpt = (recipeId = ''): Opt => ({
  kind: recipeId ? 'recipe' : 'text',
  recipeId,
  servings: '1',
  text: '',
  calories: '',
  proteinG: '',
});
const blankDay = (n: number, recipeId: string): Day => ({
  name: `Day ${n}`,
  meals: ['Breakfast', 'Lunch', 'Dinner'].map((name) => ({ name, options: [blankOpt(recipeId)] })),
});

/** PRD G8: a plan of days x meals; each meal lists options the client can swap between. Or just a PDF. */
export function MealPlanEditor({
  plan,
  recipes,
}: {
  plan: MealPlanView | null;
  recipes: { id: string; title: string }[];
}) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState(plan?.title ?? '');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [pdfId, setPdfId] = useState<string | null>(plan?.pdfMediaId ?? null);
  const [days, setDays] = useState<Day[]>(
    plan
      ? plan.days.map((d) => ({
          name: d.name,
          meals: d.meals.map((m) => ({
            name: m.name,
            options: m.options.map((o) => ({
              kind: o.recipeId ? 'recipe' : 'text',
              recipeId: o.recipeId ?? '',
              servings: String(o.servings ?? 1),
              text: o.recipeId ? '' : o.title,
              calories: o.recipeId || o.calories === null ? '' : String(o.calories),
              proteinG: o.recipeId || o.proteinG === null ? '' : String(o.proteinG),
            })),
          })),
        }))
      : [blankDay(1, recipes[0]?.id ?? '')],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const setDay = (di: number, f: (d: Day) => Day) =>
    setDays((xs) => xs.map((d, i) => (i === di ? f(d) : d)));
  const setMeal = (di: number, mi: number, f: (m: Meal) => Meal) =>
    setDay(di, (d) => ({ ...d, meals: d.meals.map((m, i) => (i === mi ? f(m) : m)) }));
  const setOpt = (di: number, mi: number, oi: number, patch: Partial<Opt>) =>
    setMeal(di, mi, (m) => ({
      ...m,
      options: m.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)),
    }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      title,
      notes,
      pdfMediaId: pdfId,
      days: days.map((d) => ({
        name: d.name,
        meals: d.meals.map((m) => ({
          name: m.name,
          options: m.options.map((o) =>
            o.kind === 'recipe'
              ? { recipeId: o.recipeId, servings: Number(o.servings) }
              : { text: o.text, calories: num(o.calories), proteinG: num(o.proteinG) },
          ),
        })),
      })),
    };
    const res = await call<{ id: string }>(
      plan ? 'PUT' : 'POST',
      plan ? `/api/v1/meal-plans/${plan.id}` : '/api/v1/meal-plans',
      body,
    );
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      const first = Object.values(fe)[0]?.[0];
      setErrors({
        ...Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])),
        form: first ?? res.message,
      });
      return;
    }
    toast.success('Meal plan saved');
    router.push('/app/meal-plans');
    router.refresh();
  }
  const err = (k: string) =>
    errors[k] ? <p className="text-sm text-danger">{errors[k]}</p> : null;

  return (
    <div className="flex flex-col gap-5">
      <label htmlFor={`${uid}-title`} className="text-sm font-medium">
        Meal plan name
      </label>
      <Input
        id={`${uid}-title`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      {err('title')}
      <label htmlFor={`${uid}-notes`} className="text-sm font-medium">
        Notes for the client (optional)
      </label>
      <textarea
        id={`${uid}-notes`}
        rows={2}
        maxLength={4000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
      />
      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}-pdf`} className="text-sm font-medium">
          Plan as a PDF (optional; use it instead of days, or alongside them)
        </label>
        <input
          id={`${uid}-pdf`}
          type="file"
          accept="application/pdf"
          className="max-w-full text-base"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            const up = await uploadMedia('nutrition', f);
            setBusy(false);
            if (up.ok) setPdfId(up.id);
            else setErrors((x) => ({ ...x, pdf: up.message }));
          }}
        />
        {err('pdf')}
        {pdfId && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <a href={`/api/v1/media/${pdfId}`} className="text-accent underline underline-offset-4">
              Current PDF
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPdfId(null)}>
              Remove PDF
            </Button>
          </p>
        )}
      </div>
      {err('days')}
      {days.map((d, di) => (
        <Card key={di}>
          <CardContent>
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-1 font-semibold">{d.name || `Day ${di + 1}`}</legend>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={`${uid}-d${di}`} className="text-sm font-medium">
                    Day {di + 1} name
                  </label>
                  <Input
                    id={`${uid}-d${di}`}
                    value={d.name}
                    maxLength={40}
                    onChange={(e) => setDay(di, (x) => ({ ...x, name: e.target.value }))}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove day ${di + 1}`}
                  onClick={() => setDays((xs) => xs.filter((_, i) => i !== di))}
                >
                  Remove day
                </Button>
              </div>
              {d.meals.map((m, mi) => {
                const at = `days.${di}.meals.${mi}`;
                const tag = `Day ${di + 1} meal ${mi + 1}`;
                return (
                  <div
                    key={mi}
                    className="flex flex-col gap-3 rounded-control border border-divider p-3"
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={`${uid}-${di}-${mi}`} className="text-sm font-medium">
                          {tag} name
                        </label>
                        <Input
                          id={`${uid}-${di}-${mi}`}
                          value={m.name}
                          maxLength={40}
                          onChange={(e) => setMeal(di, mi, (x) => ({ ...x, name: e.target.value }))}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={d.meals.length === 1}
                        aria-label={`Remove meal: ${tag.toLowerCase()}`}
                        onClick={() =>
                          setDay(di, (x) => ({ ...x, meals: x.meals.filter((_, i) => i !== mi) }))
                        }
                      >
                        Remove meal
                      </Button>
                    </div>
                    {err(`${at}.name`)}
                    {m.options.map((o, oi) => {
                      const ot = `${tag} option ${oi + 1}`;
                      const k = `${uid}-${di}-${mi}-${oi}`;
                      return (
                        <div key={oi} className="flex flex-wrap items-end gap-2">
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`${k}-kind`} className="text-sm font-medium">
                              {oi === 0 ? ot : `${ot} (or)`}
                            </label>
                            <select
                              id={`${k}-kind`}
                              value={o.kind}
                              onChange={(e) =>
                                setOpt(di, mi, oi, { kind: e.target.value as Opt['kind'] })
                              }
                              className={SELECT}
                            >
                              <option value="recipe" disabled={recipes.length === 0}>
                                A recipe
                              </option>
                              <option value="text">Described</option>
                            </select>
                          </div>
                          {o.kind === 'recipe' ? (
                            <>
                              <div className="flex min-w-0 flex-col gap-1">
                                <label htmlFor={`${k}-recipe`} className="text-sm font-medium">
                                  {ot} recipe
                                </label>
                                <select
                                  id={`${k}-recipe`}
                                  value={o.recipeId}
                                  onChange={(e) => setOpt(di, mi, oi, { recipeId: e.target.value })}
                                  className={SELECT}
                                >
                                  <option value="">Choose…</option>
                                  {recipes.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`${k}-serv`} className="text-sm font-medium">
                                  {ot} servings
                                </label>
                                <Input
                                  id={`${k}-serv`}
                                  inputMode="decimal"
                                  className="w-20"
                                  value={o.servings}
                                  onChange={(e) => setOpt(di, mi, oi, { servings: e.target.value })}
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <label htmlFor={`${k}-text`} className="text-sm font-medium">
                                  {ot} description
                                </label>
                                <Input
                                  id={`${k}-text`}
                                  value={o.text}
                                  maxLength={200}
                                  onChange={(e) => setOpt(di, mi, oi, { text: e.target.value })}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`${k}-kcal`} className="text-sm font-medium">
                                  {ot} kcal
                                </label>
                                <Input
                                  id={`${k}-kcal`}
                                  type="number"
                                  min={0}
                                  className="w-24"
                                  value={o.calories}
                                  onChange={(e) => setOpt(di, mi, oi, { calories: e.target.value })}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`${k}-prot`} className="text-sm font-medium">
                                  {ot} protein (g)
                                </label>
                                <Input
                                  id={`${k}-prot`}
                                  type="number"
                                  min={0}
                                  className="w-24"
                                  value={o.proteinG}
                                  onChange={(e) => setOpt(di, mi, oi, { proteinG: e.target.value })}
                                />
                              </div>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={m.options.length === 1}
                            aria-label={`Remove ${ot.toLowerCase()}`}
                            onClick={() =>
                              setMeal(di, mi, (x) => ({
                                ...x,
                                options: x.options.filter((_, i) => i !== oi),
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={m.options.length >= 5}
                        aria-label={`Add a swap option to ${tag.toLowerCase()}`}
                        onClick={() =>
                          setMeal(di, mi, (x) => ({ ...x, options: [...x.options, blankOpt()] }))
                        }
                      >
                        Add a swap option
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={d.meals.length >= 8}
                  aria-label={`Add a meal to day ${di + 1}`}
                  onClick={() =>
                    setDay(di, (x) => ({
                      ...x,
                      meals: [...x.meals, { name: 'Snack', options: [blankOpt()] }],
                    }))
                  }
                >
                  Add a meal
                </Button>
              </div>
            </fieldset>
          </CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={days.length >= 14}
          onClick={() => setDays((xs) => [...xs, blankDay(xs.length + 1, recipes[0]?.id ?? '')])}
        >
          Add a day
        </Button>
        <Button type="button" disabled={busy} onClick={() => void save()}>
          Save meal plan
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
