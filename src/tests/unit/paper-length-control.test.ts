import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLengthControlToWordBudget,
  getLengthControlPercent,
  shouldApplyLengthControl
} from '@/lib/paper-length-control';

const ORIGINAL_LENGTH_CONTROL = process.env.Length_Control;
const ORIGINAL_LENGTH_CONTROL_UPPER = process.env.LENGTH_CONTROL;

afterEach(() => {
  if (ORIGINAL_LENGTH_CONTROL === undefined) {
    delete process.env.Length_Control;
  } else {
    process.env.Length_Control = ORIGINAL_LENGTH_CONTROL;
  }

  if (ORIGINAL_LENGTH_CONTROL_UPPER === undefined) {
    delete process.env.LENGTH_CONTROL;
  } else {
    process.env.LENGTH_CONTROL = ORIGINAL_LENGTH_CONTROL_UPPER;
  }
});

describe('paper-length-control', () => {
  it('scales non-abstract and non-conclusion section budgets using Length_Control', () => {
    process.env.Length_Control = '70';
    delete process.env.LENGTH_CONTROL;

    expect(getLengthControlPercent()).toBe(70);
    expect(applyLengthControlToWordBudget('introduction', 1000)).toBe(700);
    expect(applyLengthControlToWordBudget('results', 100)).toBe(70);
  });

  it('does not scale abstract or conclusion budgets', () => {
    process.env.Length_Control = '70';

    expect(shouldApplyLengthControl('abstract')).toBe(false);
    expect(shouldApplyLengthControl('conclusion')).toBe(false);
    expect(applyLengthControlToWordBudget('abstract', 1000)).toBe(1000);
    expect(applyLengthControlToWordBudget('conclusion', 1000)).toBe(1000);
  });

  it('falls back safely when the env value is invalid', () => {
    process.env.Length_Control = 'not-a-number';
    process.env.LENGTH_CONTROL = '65';

    expect(getLengthControlPercent()).toBe(65);

    delete process.env.LENGTH_CONTROL;
    expect(getLengthControlPercent()).toBe(100);
    expect(applyLengthControlToWordBudget('methodology', 900)).toBe(900);
  });
});
