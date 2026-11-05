/**
 * Tests apps/web/src/features/preferences/previewSamples.ts (spec S6): all 8 question types in all 3
 * formats, length showing more or fewer points, tone switching between two wordings, and STAR.
 */
import { describe, expect, it } from 'vitest';
import type { AnswerStyle } from '@/core/storage/types';
import {
  renderSample,
  SAMPLE_QUESTION_OPTIONS,
  type SampleQuestionType,
} from '@/features/preferences/previewSamples';

/** A style to start from. */
const STYLE: AnswerStyle = { format: 'headline+bullets', length: 'medium', tone: 'simple' };

/** Every question type. */
const TYPES = SAMPLE_QUESTION_OPTIONS.map((option) => option.value);

describe('the samples', () => {
  it('lists the eight question types the spec names, in its order', () => {
    expect(SAMPLE_QUESTION_OPTIONS.map((option) => option.label)).toEqual([
      'Behavioural',
      'Coding',
      'Experience check',
      'How do you…',
      'Situational',
      'System design',
      'Technical knowledge',
      'Tell me about yourself',
    ]);
  });

  it.each(TYPES)('%s has all three formats in both wordings', (type: SampleQuestionType) => {
    for (const tone of ['simple', 'professional'] as const) {
      const read = renderSample(type, { ...STYLE, tone, format: 'paragraph' });
      expect(read.question).not.toBe('');
      expect(read.text).toBeTruthy();
      expect(read.bullets).toEqual([]);

      const both = renderSample(type, { ...STYLE, tone, format: 'headline+bullets' });
      expect(both.text).toBeTruthy();
      expect(both.bullets.length).toBeGreaterThan(0);

      const bullets = renderSample(type, { ...STYLE, tone, format: 'bullets' });
      expect(bullets.text).toBeNull();
      expect(bullets.bullets.length).toBeGreaterThan(0);
    }
  });

  it.each(TYPES)('%s shows more as the length grows', (type: SampleQuestionType) => {
    const count = (length: AnswerStyle['length']) =>
      renderSample(type, { ...STYLE, length }).bullets.length;
    expect([count('short'), count('medium'), count('detailed')]).toEqual([2, 3, 5]);
    const words = (length: AnswerStyle['length']) =>
      renderSample(type, { ...STYLE, length, format: 'paragraph' }).text!.length;
    expect(words('short')).toBeLessThan(words('medium'));
    expect(words('medium')).toBeLessThan(words('detailed'));
  });

  it.each(TYPES)('%s reads differently in each wording', (type: SampleQuestionType) => {
    const plain = renderSample(type, { ...STYLE, tone: 'simple' });
    const professional = renderSample(type, { ...STYLE, tone: 'professional' });
    expect(plain.text).not.toBe(professional.text);
    expect(plain.bullets).not.toEqual(professional.bullets);
  });

  it('the technical tone uses the professional wording', () => {
    expect(renderSample('technical', { ...STYLE, tone: 'technical' })).toEqual(
      renderSample('technical', { ...STYLE, tone: 'professional' }),
    );
  });
});

describe('STAR structure', () => {
  it('labels a behavioural answer’s points, whatever the length', () => {
    const { bullets } = renderSample('behavioural', { ...STYLE, length: 'short', star: true });
    expect(bullets.map((bullet) => bullet.split(':')[0])).toEqual([
      'Situation',
      'Task',
      'Action',
      'Result',
    ]);
  });

  it('changes nothing for other question types, or when off', () => {
    expect(renderSample('coding', { ...STYLE, star: true })).toEqual(renderSample('coding', STYLE));
    expect(renderSample('behavioural', { ...STYLE, star: false })).toEqual(
      renderSample('behavioural', STYLE),
    );
  });
});
