import {
  ALLOWED_QUANTIZATIONS,
  MIN_SHARPNESS,
  MAX_SHARPNESS,
  MAX_FILE_SIZE_BYTES,
  MIN_EVAL_LIMIT,
  MAX_EVAL_LIMIT,
  isValidQuantization,
  isValidSharpness,
  isValidEvalLimit,
} from '../validation';

describe('isValidQuantization', () => {
  describe('valid quantizations', () => {
    test.each(ALLOWED_QUANTIZATIONS)('accepts %s', (q) => {
      expect(isValidQuantization(q)).toBe(true);
    });
  });

  describe('invalid quantizations', () => {
    const invalid = [
      'f32',
      'q8_1',
      'q4_1',
      'Q4_0', // case sensitive
      'F16',
      '',
      'invalid',
      'q8_0 ', // trailing space
      ' q8_0', // leading space
      'q8_0\n',
      null as unknown as string,
      undefined as unknown as string,
    ];

    test.each(invalid)('rejects %s', (q) => {
      expect(isValidQuantization(q)).toBe(false);
    });
  });

  test('ALLOWED_QUANTIZATIONS is frozen', () => {
    // Verify the array contains expected values
    expect(ALLOWED_QUANTIZATIONS).toContain('f16');
    expect(ALLOWED_QUANTIZATIONS).toContain('q8_0');
    expect(ALLOWED_QUANTIZATIONS).toContain('q5_0');
    expect(ALLOWED_QUANTIZATIONS).toContain('q4_0');
    expect(ALLOWED_QUANTIZATIONS.length).toBe(4);
  });
});

describe('isValidSharpness', () => {
  describe('valid values', () => {
    const valid = [0, 1, 50, 99, 100, 0.5, 99.9, MIN_SHARPNESS, MAX_SHARPNESS];

    test.each(valid)('accepts %s', (v) => {
      expect(isValidSharpness(v)).toBe(true);
    });
  });

  describe('invalid values', () => {
    const invalid = [
      [-1, 'below min'],
      [-0.001, 'just below min'],
      [101, 'above max'],
      [100.001, 'just above max'],
      [Infinity, 'infinity'],
      [-Infinity, 'negative infinity'],
      [NaN, 'NaN'],
      [1000, 'way above max'],
    ];

    test.each(invalid)('rejects %s (%s)', (v) => {
      expect(isValidSharpness(v as number)).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    test('MIN_SHARPNESS (0) is valid', () => {
      expect(isValidSharpness(MIN_SHARPNESS)).toBe(true);
    });

    test('MAX_SHARPNESS (100) is valid', () => {
      expect(isValidSharpness(MAX_SHARPNESS)).toBe(true);
    });

    test('just below min is invalid', () => {
      expect(isValidSharpness(MIN_SHARPNESS - 0.001)).toBe(false);
    });

    test('just above max is invalid', () => {
      expect(isValidSharpness(MAX_SHARPNESS + 0.001)).toBe(false);
    });
  });
});

describe('isValidEvalLimit', () => {
  describe('valid values', () => {
    const valid = [0.01, 0.1, 0.5, 0.99, 1.0, MIN_EVAL_LIMIT, MAX_EVAL_LIMIT];

    test.each(valid)('accepts %s', (v) => {
      expect(isValidEvalLimit(v)).toBe(true);
    });
  });

  describe('invalid values', () => {
    const invalid = [
      [0, 'zero'],
      [0.009, 'below min'],
      [1.001, 'above max'],
      [2, 'way above max'],
      [-0.5, 'negative'],
      [Infinity, 'infinity'],
      [-Infinity, 'negative infinity'],
      [NaN, 'NaN'],
    ];

    test.each(invalid)('rejects %s (%s)', (v) => {
      expect(isValidEvalLimit(v as number)).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    test('MIN_EVAL_LIMIT (0.01) is valid', () => {
      expect(isValidEvalLimit(MIN_EVAL_LIMIT)).toBe(true);
    });

    test('MAX_EVAL_LIMIT (1.0) is valid', () => {
      expect(isValidEvalLimit(MAX_EVAL_LIMIT)).toBe(true);
    });

    test('just below min is invalid', () => {
      expect(isValidEvalLimit(MIN_EVAL_LIMIT - 0.001)).toBe(false);
    });

    test('just above max is invalid', () => {
      expect(isValidEvalLimit(MAX_EVAL_LIMIT + 0.001)).toBe(false);
    });
  });
});

describe('constants sanity checks', () => {
  test('MIN_SHARPNESS is 0', () => {
    expect(MIN_SHARPNESS).toBe(0);
  });

  test('MAX_SHARPNESS is 100', () => {
    expect(MAX_SHARPNESS).toBe(100);
  });

  test('MAX_FILE_SIZE_BYTES is 100MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
  });

  test('MIN_EVAL_LIMIT is 0.01', () => {
    expect(MIN_EVAL_LIMIT).toBe(0.01);
  });

  test('MAX_EVAL_LIMIT is 1.0', () => {
    expect(MAX_EVAL_LIMIT).toBe(1.0);
  });
});
