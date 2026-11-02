/**
 * File: apps/web/tests/integration/harness/next-navigation-stub.ts
 * Purpose: Stands in for next/navigation in the setup harness bundle (esbuild alias), where there
 *          is no Next.js router: push() tells the harness where the app wanted to go.
 * Used by: tests/integration/setup.spec.ts (esbuild `alias: { 'next/navigation': … }`)
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing)
 */

/** The router object, the same one every time, so effects that depend on it do not re-run. */
const router = {
  /**
   * Tells the harness where the app wanted to go.
   *
   * @param href The address.
   */
  push(href: string) {
    window.dispatchEvent(new CustomEvent('kite-harness-push', { detail: href }));
  },
};

/**
 * The stand-in router.
 *
 * @returns The router.
 * Called from: components under test that use next/navigation
 */
export function useRouter() {
  return router;
}

/**
 * The stand-in current path.
 *
 * @returns Always the dashboard.
 * Called from: components under test that use next/navigation
 */
export function usePathname() {
  return '/';
}
