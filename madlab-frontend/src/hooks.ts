import { useEffect, useCallback } from 'react';

/**
 * Polls a function at a given interval, pausing when tab is hidden.
 */
export function usePolling(fetchFn: () => void, intervalMs: number) {
    const stableFetch = useCallback(fetchFn, [fetchFn]);

    useEffect(() => {
        stableFetch();
        let interval: ReturnType<typeof setInterval> | null = setInterval(stableFetch, intervalMs);

        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (interval) { clearInterval(interval); interval = null; }
            } else if (!interval) {
                stableFetch();
                interval = setInterval(stableFetch, intervalMs);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            if (interval) clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [stableFetch, intervalMs]);
}

/**
 * Calls onEscape when Escape key is pressed while active is true.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [active, onEscape]);
}
