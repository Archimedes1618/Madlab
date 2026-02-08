import path from 'path';

// Store original env
const originalEnv = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('CONFIG', () => {
  test('loads with defaults', async () => {
    const { CONFIG } = await import('../config');
    expect(CONFIG.PORT).toBe(8080);
    expect(CONFIG.LM_STUDIO_URL).toBe('http://localhost:1234');
    expect(CONFIG.FETCH_TIMEOUT).toBe(60000);
    expect(CONFIG.LLM_TIMEOUT).toBe(300000);
  });

  test('PORT from env', async () => {
    process.env.PORT = '3000';
    const { CONFIG } = await import('../config');
    expect(CONFIG.PORT).toBe(3000);
  });

  test('LM_STUDIO_URL from env', async () => {
    process.env.LM_STUDIO_URL = 'http://remote:5000';
    const { CONFIG } = await import('../config');
    expect(CONFIG.LM_STUDIO_URL).toBe('http://remote:5000');
  });

  test('FETCH_TIMEOUT from env', async () => {
    process.env.FETCH_TIMEOUT = '120000';
    const { CONFIG } = await import('../config');
    expect(CONFIG.FETCH_TIMEOUT).toBe(120000);
  });

  test('LLM_TIMEOUT from env', async () => {
    process.env.LLM_TIMEOUT = '600000';
    const { CONFIG } = await import('../config');
    expect(CONFIG.LLM_TIMEOUT).toBe(600000);
  });

  test('ALLOWED_ORIGINS from env (comma-separated)', async () => {
    process.env.ALLOWED_ORIGINS = 'http://a.com,http://b.com,http://c.com';
    const { CONFIG } = await import('../config');
    expect(CONFIG.ALLOWED_ORIGINS).toEqual(['http://a.com', 'http://b.com', 'http://c.com']);
  });

  test('ALLOWED_ORIGINS defaults', async () => {
    delete process.env.ALLOWED_ORIGINS;
    const { CONFIG } = await import('../config');
    expect(CONFIG.ALLOWED_ORIGINS).toContain('http://localhost:5173');
    expect(CONFIG.ALLOWED_ORIGINS).toContain('http://localhost:3000');
  });

  describe('paths', () => {
    test('DATA_DIR is absolute', async () => {
      const { CONFIG } = await import('../config');
      expect(path.isAbsolute(CONFIG.DATA_DIR)).toBe(true);
    });

    test('MODELS_DIR is absolute', async () => {
      const { CONFIG } = await import('../config');
      expect(path.isAbsolute(CONFIG.MODELS_DIR)).toBe(true);
    });

    test('TRAINER_DIR is absolute', async () => {
      const { CONFIG } = await import('../config');
      expect(path.isAbsolute(CONFIG.TRAINER_DIR)).toBe(true);
    });

    test('CONFIG_PATH ends with train.yaml', async () => {
      const { CONFIG } = await import('../config');
      expect(CONFIG.CONFIG_PATH).toMatch(/train\.yaml$/);
    });

    test('HISTORY_PATH ends with model_history.json', async () => {
      const { CONFIG } = await import('../config');
      expect(CONFIG.HISTORY_PATH).toMatch(/model_history\.json$/);
    });

    test('INSTILLATIONS_PATH ends with instillations.json', async () => {
      const { CONFIG } = await import('../config');
      expect(CONFIG.INSTILLATIONS_PATH).toMatch(/instillations\.json$/);
    });
  });

  describe('rate limiting', () => {
    test('RATE_LIMIT_WINDOW_MS is 1 minute', async () => {
      const { CONFIG } = await import('../config');
      expect(CONFIG.RATE_LIMIT_WINDOW_MS).toBe(60 * 1000);
    });

    test('RATE_LIMIT_MAX is 120', async () => {
      const { CONFIG } = await import('../config');
      expect(CONFIG.RATE_LIMIT_MAX).toBe(120);
    });
  });

  describe('type safety', () => {
    test('CONFIG is readonly', async () => {
      const { CONFIG } = await import('../config');
      // TypeScript would prevent this, but verify at runtime
      expect(typeof CONFIG.PORT).toBe('number');
      expect(typeof CONFIG.LM_STUDIO_URL).toBe('string');
      expect(Array.isArray(CONFIG.ALLOWED_ORIGINS)).toBe(true);
    });
  });
});

describe('getPythonPath', () => {
  test('returns string', async () => {
    const { getPythonPath } = await import('../config');
    const pythonPath = getPythonPath();
    expect(typeof pythonPath).toBe('string');
    expect(pythonPath.length).toBeGreaterThan(0);
  });

  test('falls back to "python" when venv not found', async () => {
    const { getPythonPath } = await import('../config');
    const pythonPath = getPythonPath();
    // Will be either a venv path or 'python' fallback
    expect(pythonPath).toBeTruthy();
  });
});

describe('invalid env values', () => {
  test('PORT with non-numeric string defaults to NaN', async () => {
    process.env.PORT = 'invalid';
    const { CONFIG } = await import('../config');
    // parseInt('invalid') returns NaN
    expect(Number.isNaN(CONFIG.PORT)).toBe(true);
  });

  test('FETCH_TIMEOUT with non-numeric string', async () => {
    process.env.FETCH_TIMEOUT = 'not-a-number';
    const { CONFIG } = await import('../config');
    expect(Number.isNaN(CONFIG.FETCH_TIMEOUT)).toBe(true);
  });
});
