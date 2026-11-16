/**
 * Tests for apps/web/src/server/aiBudget.ts (ADR-0089, ADR-0091): the live answers input-budget facts,
 * with answerBudgetUse() from @kite/shared: the largest request without a global prompt fits the budget,
 * the default-sized prompt does not warn, and a prompt as large as the budget does.
 */
import { answerBudgetUse } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { budgetFacts } from '@/server/aiBudget';

describe('budgetFacts', () => {
  it('counts the global prompt with its heading, and warns only near the budget', () => {
    const facts = budgetFacts();
    expect(facts.baseTokens).toBeGreaterThan(0);
    expect(facts.baseTokens).toBeLessThan(facts.budgetTokens);
    expect(answerBudgetUse({ ...facts, chars: 15_000 + facts.headingChars }).near).toBe(false);
    expect(
      answerBudgetUse({ ...facts, chars: facts.budgetTokens * facts.charsPerToken }).near,
    ).toBe(true);
  });
});
