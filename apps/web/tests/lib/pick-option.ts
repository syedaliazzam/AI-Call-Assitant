/**
 * File: apps/web/tests/lib/pick-option.ts
 * Purpose: Chooses an option in the app's Select (src/ui/Select.tsx), which is drawn in the page, so
 *          Playwright's selectOption() (native <select> only) cannot be used on it.
 * Used by: apps/web/tests/integration/*, apps/web/tests/ui/*, apps/web/tests/e2e-prod/*
 * Depends on: @playwright/test
 * Architecture: docs/design/paramount-ai-ui-spec.md §3
 */
import type { Locator, Page } from '@playwright/test';

/**
 * Opens a Select and presses one of its options.
 *
 * @param page   The page (the list opens in the top layer, outside the field's own element).
 * @param field  The Select's closed field.
 * @param option The option's words, exactly as shown.
 * @returns Resolves once the option is pressed.
 * Called from: the Playwright specs that choose from a Select
 */
export async function pickOption(page: Page, field: Locator, option: string): Promise<void> {
  await field.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
