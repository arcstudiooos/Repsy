import { getBranding, type Branding } from '@kinetic/core';
import { RepsyMark } from '@/components/brand/Logo';
import { withServerTenant } from '@/server/serverActor';

/**
 * The portal header's workspace name and logo, and the workspace accent (PRD A6). Values are validated on save
 * (#rrggbb, https), so the style tag carries nothing user-shaped beyond two hex colours. Falls back to Repsy.
 */
export async function PortalBrand() {
  let brand: Branding | null = null;
  try {
    brand = await withServerTenant((tx) => getBranding(tx));
  } catch {
    brand = null;
  }
  const accent = brand?.accent && /^#[0-9a-f]{6}$/.test(brand.accent) ? brand.accent : null;
  const hover =
    brand?.accentHover && /^#[0-9a-f]{6}$/.test(brand.accentHover) ? brand.accentHover : null;
  return (
    <>
      {accent && hover && <style>{`:root{--k-accent:${accent};--k-accent-hover:${hover}}`}</style>}
      <p className="flex min-w-0 items-center gap-2 text-lg font-semibold">
        {!brand?.logoUrl && <RepsyMark className="size-7" />}
        {brand?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a coach-hosted https logo; no image optimizer domain to allow-list.
          <img
            src={brand.logoUrl}
            alt=""
            width={28}
            height={28}
            referrerPolicy="no-referrer"
            className="size-7 shrink-0 rounded-control object-contain"
          />
        )}
        <span className="truncate">{brand?.name ?? 'Repsy'}</span>
      </p>
    </>
  );
}
