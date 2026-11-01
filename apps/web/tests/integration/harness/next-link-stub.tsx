/**
 * File: apps/web/tests/integration/harness/next-link-stub.tsx
 * Purpose: Stands in for next/link in the harness bundles (esbuild alias), where there is no
 *          Next.js router: a plain <a> with the same href and children.
 * Used by: tests/integration/review.spec.ts (esbuild `alias: { 'next/link': … }`)
 * Depends on: react
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing)
 */
import type { AnchorHTMLAttributes } from 'react';

/** Props: the anchor's attributes, with href required (as for next/link). */
interface StubLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Where the link goes. */
  href: string;
}

/**
 * A plain link.
 *
 * @param props The anchor's attributes.
 * @returns An <a>.
 * Rendered by: components under test that use next/link
 */
export default function Link(props: StubLinkProps) {
  return <a {...props} />;
}
