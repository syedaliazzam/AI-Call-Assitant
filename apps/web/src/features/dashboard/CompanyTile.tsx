/**
 * File: apps/web/src/features/dashboard/CompanyTile.tsx
 * Purpose: The 24 px tile beside a company's name: its logo from Brandfetch when there is one, or a
 *          letter on a colour. Any failure, being offline, having company suggestions off or having no
 *          client ID all give the letter (ADR-0048).
 * Used by: src/features/dashboard/SessionCard.tsx, src/features/session-setup/CompanyField.tsx
 * Depends on: src/core/companies/brandfetch.ts, src/core/storage/companyPrefs.ts,
 *             ./sessionCardParts.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3, S4);
 *               docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 */
'use client';

import { useState } from 'react';
import { brandLogoUrl } from '@/core/companies/brandfetch';
import { companySuggestionsOn } from '@/core/storage/companyPrefs';
import { letterTile } from './sessionCardParts';

/** Props for CompanyTile. */
export interface CompanyTileProps {
  /** The name the letter comes from. */
  name: string;
  /** The company's domain, when known. */
  domain?: string | null | undefined;
  /** An icon's address from a search just now; never stored. Used before the domain. */
  iconUrl?: string | null | undefined;
}

/**
 * The tile.
 *
 * @param props See CompanyTileProps.
 * @returns The logo or the letter.
 * Rendered by: SessionCard.tsx, CompanyField.tsx
 */
export function CompanyTile({ name, domain, iconUrl }: CompanyTileProps) {
  // Remembers which address failed, so a different company in the same place still tries its own.
  const [failed, setFailed] = useState<string | null>(null);
  const src = companySuggestionsOn() ? (iconUrl ?? (domain ? brandLogoUrl(domain) : null)) : null;

  if (src && src !== failed) {
    return (
      // A plain image, as Brandfetch requires: next/image would fetch and keep a copy on our server.
      // Its rules also need the page's address in the Referer, so that is stated here.
      // A logo can be dark or see-through, so its background stays white in the dark theme too.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setFailed(src)}
        className="size-6 shrink-0 rounded-[6px] bg-white object-contain"
      />
    );
  }

  const { letter, colour } = letterTile(name);
  return (
    <span
      aria-hidden="true"
      // The colour is a token chosen by number, so the theme holds every value.
      style={{ backgroundColor: `var(--k-tile-${colour})` }}
      className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[13px] font-semibold text-ui-on-accent"
    >
      {letter}
    </span>
  );
}
