/**
 * Tests for apps/web/scripts/lib/require-key.ts: missingKeyReason() refuses a missing or blank
 * ANTHROPIC_API_KEY and accepts any set key (Kite uses one key; there is no workspace check),
 * and its reason never contains a key.
 */
import { describe, expect, it } from 'vitest';
import { missingKeyReason } from '../../../scripts/lib/require-key';

describe('missingKeyReason', () => {
  it('refuses a missing or blank key, and accepts a set one', () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '  ' }]) {
      expect(missingKeyReason(env)).toContain('ANTHROPIC_API_KEY is missing');
    }
    expect(missingKeyReason({ ANTHROPIC_API_KEY: 'sk-ant-INVENTED' })).toBeNull();
  });
});
