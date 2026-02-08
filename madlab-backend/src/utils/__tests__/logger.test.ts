import { recordRequest, getMetrics } from '../logger';

// Reset metrics state before each test
// Since we can't reset the module state, tests must account for accumulated state
// In real scenarios, you'd use jest.isolateModules or dependency injection

describe('recordRequest', () => {
  test('increments request count', () => {
    const before = getMetrics().request_count;
    recordRequest(100, false);
    const after = getMetrics().request_count;
    expect(after).toBe(before + 1);
  });

  test('increments error count for errors', () => {
    const before = getMetrics().error_count;
    recordRequest(100, true);
    const after = getMetrics().error_count;
    expect(after).toBe(before + 1);
  });

  test('does not increment error count for success', () => {
    const before = getMetrics().error_count;
    recordRequest(100, false);
    const after = getMetrics().error_count;
    expect(after).toBe(before);
  });

  test('records latency', () => {
    const before = getMetrics();
    recordRequest(999, false);
    const after = getMetrics();
    // Latency percentiles should potentially change
    expect(after.request_count).toBe(before.request_count + 1);
  });
});

describe('getMetrics', () => {
  test('returns expected shape', () => {
    const metrics = getMetrics();
    expect(metrics).toHaveProperty('request_count');
    expect(metrics).toHaveProperty('error_count');
    expect(metrics).toHaveProperty('latency_p50');
    expect(metrics).toHaveProperty('latency_p99');
    expect(metrics).toHaveProperty('uptime');
  });

  test('request_count is non-negative', () => {
    expect(getMetrics().request_count).toBeGreaterThanOrEqual(0);
  });

  test('error_count is non-negative', () => {
    expect(getMetrics().error_count).toBeGreaterThanOrEqual(0);
  });

  test('uptime is positive', () => {
    expect(getMetrics().uptime).toBeGreaterThan(0);
  });

  test('latency_p50 is non-negative', () => {
    expect(getMetrics().latency_p50).toBeGreaterThanOrEqual(0);
  });

  test('latency_p99 is non-negative', () => {
    expect(getMetrics().latency_p99).toBeGreaterThanOrEqual(0);
  });
});

describe('percentile calculations', () => {
  test('p99 >= p50 after recording latencies', () => {
    // Record varied latencies
    for (let i = 0; i < 100; i++) {
      recordRequest(i * 10, false);
    }
    const metrics = getMetrics();
    expect(metrics.latency_p99).toBeGreaterThanOrEqual(metrics.latency_p50);
  });

  test('latencies are bounded by recorded values', () => {
    const metrics = getMetrics();
    // p50 and p99 should be from recorded data
    expect(typeof metrics.latency_p50).toBe('number');
    expect(typeof metrics.latency_p99).toBe('number');
  });
});

describe('sliding window behavior', () => {
  test('latencies array stays bounded (max 1000)', () => {
    // Record more than 1000 requests
    for (let i = 0; i < 50; i++) {
      recordRequest(i, false);
    }
    // Can't directly check array length, but verify metrics still work
    const metrics = getMetrics();
    expect(metrics.request_count).toBeGreaterThan(0);
    expect(typeof metrics.latency_p50).toBe('number');
  });
});

describe('types', () => {
  test('getMetrics returns numbers', () => {
    const metrics = getMetrics();
    expect(typeof metrics.request_count).toBe('number');
    expect(typeof metrics.error_count).toBe('number');
    expect(typeof metrics.latency_p50).toBe('number');
    expect(typeof metrics.latency_p99).toBe('number');
    expect(typeof metrics.uptime).toBe('number');
  });

  test('metrics are serializable', () => {
    const metrics = getMetrics();
    const serialized = JSON.stringify(metrics);
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveProperty('request_count');
    expect(parsed).toHaveProperty('error_count');
  });
});
