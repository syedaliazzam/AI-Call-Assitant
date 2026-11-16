/**
 * Tests for apps/web/src/server/aiQuality.ts (ADR-0089), with the Anthropic SDK mocked:
 * - handleQualityCheck(): 401 signed out or temporary password, 403 for a non-admin (nothing counted or
 *   run), 400 for a bad body, 429 over the daily limit; the live prompt is measured once (in parallel
 *   with the draft) and remembered, later checks reuse its score; a draft equal to the live prompt runs
 *   once; the reply carries the save token and a warning for a drop of 0.3 or a failed honesty or format
 *   case; logs hold scores and sizes only;
 * - codeChecks() and scoreScenario(): the hidden lines, the empty reply for "nothing asked", the coding
 *   and paragraph shapes, honesty from the grade;
 * - runQualityCheck(): 8 answers with the draft after the contract, one grading request, a mean score
 *   and a cost.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { QualityScenarioResult } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityDeps, QualityRun } from '@/server/aiQuality';
import { fakeMessageStream } from '../../helpers/fakeClaude';

/** Spy standing in for client.messages.stream() (the answers). */
const streamMock = vi.fn();
/** Spy standing in for client.messages.create() (the grading). */
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Subclass the real client so its static error classes stay real for instanceof.
  class FakeAnthropic extends actual.default {
    override messages = {
      stream: streamMock,
      create: createMock,
    } as unknown as Anthropic['messages'];
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
});
vi.mock('@/server/db', () => ({ db: {} }));
vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
vi.stubEnv('KITE_MODEL_FAST', 'claude-haiku-5-5');
vi.stubEnv('KITE_MODEL_SMART', 'claude-sonnet-5-5');

const {
  codeChecks,
  handleQualityCheck,
  promptHash,
  QUALITY_SCENARIOS,
  runQualityCheck,
  scoreScenario,
} = await import('@/server/aiQuality');
const { GLOBAL_HEADING, LIVE_CONTRACT } = await import('@/server/prompts/contract');

/** The models (invented names are fine: the SDK is mocked). */
const MODELS = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' };

/** An admin who has changed their password. */
const ADMIN = { id: 'admin-1', role: 'admin', mustChangePassword: false };

/**
 * A run with one score for every scenario.
 *
 * @param score The score.
 * @param passed Whether every case passed.
 * @returns The run.
 */
function run(score: number, passed = true): QualityRun {
  const scenarios: QualityScenarioResult[] = QUALITY_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    score,
    passed,
    reason: '',
  }));
  return { score, scenarios, cost: 0.02 };
}

/**
 * Fake dependencies.
 *
 * @param overrides Parts to replace.
 * @returns The deps, with spies.
 */
function deps(overrides: Partial<QualityDeps> = {}): QualityDeps {
  return {
    models: () => MODELS,
    count: vi.fn(async () => ({ allowed: true, limit: 300 })),
    livePrompt: vi.fn(async () => 'LIVE-SECRET prompt'),
    findScore: vi.fn(async () => null),
    record: vi.fn(async () => undefined),
    run: vi.fn(async (prompt: string) => (prompt.startsWith('LIVE') ? run(9.2) : run(9.0))),
    tokenFor: vi.fn(() => 'TOKEN-Q'),
    ...overrides,
  };
}

/** A valid body. */
const BODY = JSON.stringify({ prompt: 'DRAFT-SECRET prompt' });

const signal = new AbortController().signal;

beforeEach(() => {
  streamMock.mockReset();
  createMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('handleQualityCheck', () => {
  it('refuses signed-out and non-admin callers before counting or running anything', async () => {
    const d = deps();
    expect((await handleQualityCheck(null, BODY, d, signal)).status).toBe(401);
    expect(
      (await handleQualityCheck({ ...ADMIN, mustChangePassword: true }, BODY, d, signal)).status,
    ).toBe(401);
    for (const role of ['user', null, undefined]) {
      const user = { id: 'u1', role, mustChangePassword: false };
      expect((await handleQualityCheck(user, BODY, d, signal)).status).toBe(403);
    }
    expect(d.count).not.toHaveBeenCalled();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('refuses a bad body, and answers 429 over the daily limit without running', async () => {
    const d = deps();
    expect((await handleQualityCheck(ADMIN, 'nope', d, signal)).status).toBe(400);
    expect((await handleQualityCheck(ADMIN, '{"prompt":1}', d, signal)).status).toBe(400);
    const limited = deps({ count: vi.fn(async () => ({ allowed: false, limit: 300 })) });
    expect((await handleQualityCheck(ADMIN, BODY, limited, signal)).status).toBe(429);
    expect(d.run).not.toHaveBeenCalled();
    expect(limited.run).not.toHaveBeenCalled();
  });

  it('measures the live prompt once, remembers both, and returns the token and scores', async () => {
    const d = deps();
    const response = await handleQualityCheck(ADMIN, BODY, d, signal);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      score: number;
      liveScore: number;
      promptToken: string;
      warning: string | null;
    };
    expect(body).toMatchObject({ score: 9, liveScore: 9.2, promptToken: 'TOKEN-Q', warning: null });
    expect(d.run).toHaveBeenCalledTimes(2);
    expect(d.record).toHaveBeenCalledWith(promptHash('DRAFT-SECRET prompt'), expect.anything());
    expect(d.record).toHaveBeenCalledWith(promptHash('LIVE-SECRET prompt'), expect.anything());
    expect(d.tokenFor).toHaveBeenCalledWith('live', 'DRAFT-SECRET prompt');
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const secret of ['DRAFT-SECRET', 'LIVE-SECRET', 'TOKEN-Q', 'admin-1']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('reuses a remembered live score, and runs once when the draft is the live prompt', async () => {
    const known = deps({ findScore: vi.fn(async () => 9.4) });
    const body = await (await handleQualityCheck(ADMIN, BODY, known, signal)).json();
    expect(known.run).toHaveBeenCalledTimes(1);
    expect(body.liveScore).toBe(9.4);
    const same = deps();
    const sameBody = await (
      await handleQualityCheck(
        ADMIN,
        JSON.stringify({ prompt: 'LIVE-SECRET prompt\r\n' }),
        same,
        signal,
      )
    ).json();
    expect(same.run).toHaveBeenCalledTimes(1);
    expect(same.findScore).not.toHaveBeenCalled();
    expect(sameBody.liveScore).toBe(sameBody.score);
  });

  it('warns for a drop of 0.3 or more, and for a failed honesty or format case', async () => {
    const drop = deps({ findScore: vi.fn(async () => 9.4), run: vi.fn(async () => run(9.1)) });
    const dropped = await (await handleQualityCheck(ADMIN, BODY, drop, signal)).json();
    expect(dropped.warning).toContain('dropped by 0.3');
    const fail = deps({
      findScore: vi.fn(async () => 9.0),
      run: vi.fn(async () => run(9.0, false)),
    });
    const failed = await (await handleQualityCheck(ADMIN, BODY, fail, signal)).json();
    expect(failed.warning).toContain('Failed:');
  });

  it('still answers when remembering a score fails', async () => {
    const d = deps({ record: vi.fn(async () => Promise.reject(new Error('db down'))) });
    expect((await handleQualityCheck(ADMIN, BODY, d, signal)).status).toBe(200);
  });
});

describe('codeChecks and scoreScenario', () => {
  const meta = { type: 'concept' as const, target: 'call' as const, source: 'general' as const };

  it('fails a reply missing a hidden line, whatever the grade', () => {
    const checks = codeChecks({ shape: null }, { text: 'Hi.', meta: null, question: 'Q?' });
    expect(checks.contract).toBe(false);
    const scenario = QUALITY_SCENARIOS.find((item) => item.id === 'concept')!;
    const grade = { id: 'concept', facts: 3, grounded: 2, style: 1, reason: 'none', invented: [] };
    const result = scoreScenario(scenario, { text: 'Hi.', meta, question: null }, grade);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThanOrEqual(3);
  });

  it('wants no answer for "nothing asked", and the coding and paragraph shapes', () => {
    expect(codeChecks({ shape: 'none' }, { text: '', meta, question: 'Q?' }).shape).toBe(true);
    expect(codeChecks({ shape: 'none' }, { text: 'Sure!', meta, question: 'Q?' }).shape).toBe(
      false,
    );
    const code =
      'Two pointers.\nKey steps:\n- a\n```python\nx = 1\n```\nComplexity: O(n)\nSay: easy.';
    expect(codeChecks({ shape: 'coding' }, { text: code, meta, question: 'Q?' }).shape).toBe(true);
    expect(
      codeChecks({ shape: 'coding' }, { text: 'Two pointers.', meta, question: 'Q?' }).shape,
    ).toBe(false);
    expect(
      codeChecks({ shape: 'paragraph' }, { text: 'One paragraph.', meta, question: 'Q?' }).shape,
    ).toBe(true);
    expect(
      codeChecks({ shape: 'paragraph' }, { text: 'Line.\n- bullet', meta, question: 'Q?' }).shape,
    ).toBe(false);
  });

  it('fails an honesty case with anything invented', () => {
    const scenario = QUALITY_SCENARIOS.find((item) => item.kind === 'honesty')!;
    const grade = {
      id: scenario.id,
      facts: 3,
      grounded: 1,
      style: 1,
      reason: 'x',
      invented: ['ISO 27001'],
    };
    expect(scoreScenario(scenario, { text: 'Yes.', meta, question: 'Q?' }, grade).passed).toBe(
      false,
    );
  });
});

describe('runQualityCheck', () => {
  it('answers 8 scenarios with the draft after the contract, then grades them in one request', async () => {
    streamMock.mockImplementation(() =>
      fakeMessageStream({ pieces: ['[[concept|call|general]]\nAn answer.\n[[question|Q?]]'] }),
    );
    const gradedIds = QUALITY_SCENARIOS.filter(
      (scenario) => scenario.shape !== 'none' && scenario.shape !== 'smalltalk',
    ).map((scenario) => scenario.id);
    createMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            grades: gradedIds.map((id) => ({
              id,
              facts: 3,
              grounded: 2,
              style: 1,
              reason: 'none',
              invented: [],
            })),
          }),
        },
      ],
      usage: { input_tokens: 5_000, output_tokens: 600 },
    });
    const result = await runQualityCheck('DRAFT prompt', MODELS);
    expect(streamMock).toHaveBeenCalledTimes(QUALITY_SCENARIOS.length);
    expect(QUALITY_SCENARIOS).toHaveLength(8);
    for (const [params] of streamMock.mock.calls) {
      expect(params.system[0].text).toBe(`${LIVE_CONTRACT}\n\n${GLOBAL_HEADING}\nDRAFT prompt`);
    }
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.scenarios).toHaveLength(8);
    // "Nothing asked" got an answer and small talk was not marked smalltalk: both fail in code.
    expect(result.scenarios.find((item) => item.id === 'none')!.passed).toBe(false);
    expect(result.scenarios.find((item) => item.id === 'smalltalk')!.passed).toBe(false);
    expect(result.scenarios.find((item) => item.id === 'concept')!.score).toBe(10);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.cost).toBeLessThan(0.1);
  });
});
