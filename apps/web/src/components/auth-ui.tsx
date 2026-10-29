import type { ReactNode } from 'react';

export const inputClass =
  'block w-full min-h-11 rounded-lg border border-[#7D8C87] bg-white px-3 text-base text-[#152825] focus:outline-2 focus:outline-offset-2 focus:outline-[#1C7666]';
export const buttonClass =
  'min-h-11 w-full rounded-lg bg-[#1C7666] px-4 text-base font-medium text-white hover:bg-[#145B50] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1C7666]';
export const secondaryButtonClass =
  'min-h-11 w-full rounded-lg border border-[#7D8C87] bg-white px-4 text-base font-medium text-[#152825] hover:bg-[#F7F8F6]';
export const linkClass = 'text-[#1C7666] underline underline-offset-2 hover:text-[#145B50]';

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F8F6] px-4 py-8">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-[#152825] shadow-[0_4px_18px_rgba(16,36,30,.05)] sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  defaultValue?: string;
  minLength?: number;
}) {
  const { label, name, error, hint, ...rest } = props;
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  return (
    <div className="mb-4">
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-sm text-[#60716E]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-sm text-[#B64743]">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ children, tone }: { children: ReactNode; tone: 'error' | 'info' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-4 text-sm ${tone === 'error' ? 'text-[#B64743]' : 'text-[#60716E]'}`}
    >
      {children}
    </p>
  );
}
