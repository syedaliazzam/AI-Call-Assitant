/**
 * Tests for apps/web/scripts/lib/require-prod.ts (ADR-0050): a database-writing script runs only with
 * --prod; without it the refusal says the database is production and how to confirm.
 */
import { describe, expect, it } from 'vitest';
import { PROD_FLAG, productionRefusal } from '../../../scripts/lib/require-prod';

describe('productionRefusal', () => {
  it('refuses without --prod, naming production and the flag', () => {
    const reason = productionRefusal(['node', 'create-admin.ts', '--email', 'a@b.test']);
    expect(reason).toContain('PRODUCTION');
    expect(reason).toContain(PROD_FLAG);
  });

  it('allows the run with --prod anywhere on the line', () => {
    expect(productionRefusal(['node', 'e2e-admin.ts', '--enable', '--prod'])).toBeNull();
    expect(productionRefusal(['node', 'db-migrate.ts', '--prod'])).toBeNull();
  });

  it('does not take a look-alike for the flag', () => {
    expect(productionRefusal(['node', 'x.ts', '--production', '--prod=no'])).not.toBeNull();
  });
});
