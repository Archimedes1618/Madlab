let mockFetchWithTimeout: jest.Mock;

jest.mock('../../utils/fetch', () => ({
    fetchWithTimeout: (...args: any[]) => mockFetchWithTimeout(...args),
}));
jest.mock('../../config', () => ({
    CONFIG: { LM_STUDIO_URL: 'http://localhost:1234' },
}));

describe('lmStudioHealth', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        mockFetchWithTimeout = jest.fn();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('returns false initially', async () => {
        const { isLMStudioHealthy } = await import('../lmStudioHealth');
        expect(isLMStudioHealthy()).toBe(false);
    });

    it('returns unhealthy status initially', async () => {
        const { getLMStudioStatus } = await import('../lmStudioHealth');
        expect(getLMStudioStatus().status).toBe('unhealthy');
    });

    it('performs immediate health check on startHealthProbe', async () => {
        mockFetchWithTimeout.mockResolvedValue({ ok: true });

        const { startHealthProbe } = await import('../lmStudioHealth');
        startHealthProbe(jest.fn());

        // Run only one timer iteration (the immediate probe() call)
        await jest.advanceTimersToNextTimerAsync();

        expect(mockFetchWithTimeout).toHaveBeenCalledWith(
            'http://localhost:1234/v1/models',
            {},
            5000
        );
    });

    it('broadcasts online when health check passes', async () => {
        mockFetchWithTimeout.mockResolvedValue({ ok: true });
        const broadcast = jest.fn();

        const { startHealthProbe, isLMStudioHealthy } = await import('../lmStudioHealth');
        startHealthProbe(broadcast);

        // Wait for the immediate probe to complete
        await jest.advanceTimersToNextTimerAsync();

        expect(isLMStudioHealthy()).toBe(true);
        expect(broadcast).toHaveBeenCalledWith({
            type: 'status',
            payload: { message: 'LM Studio online' },
        });
    });

    it('handles fetch errors gracefully', async () => {
        mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

        const { startHealthProbe, isLMStudioHealthy } = await import('../lmStudioHealth');
        startHealthProbe(jest.fn());

        // Wait for the immediate probe to complete
        await jest.advanceTimersToNextTimerAsync();

        expect(isLMStudioHealthy()).toBe(false);
    });
});
