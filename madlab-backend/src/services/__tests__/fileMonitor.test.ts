import { EventEmitter } from 'events';

const mockWatch = jest.fn();
const mockMkdir = jest.fn();
const mockStat = jest.fn();

jest.mock('chokidar', () => ({ watch: (...args: any[]) => mockWatch(...args) }));
jest.mock('fs/promises', () => ({
    mkdir: (...args: any[]) => mockMkdir(...args),
    stat: (...args: any[]) => mockStat(...args),
}));
jest.mock('../../config', () => ({ CONFIG: { MODELS_DIR: '/fake/models' } }));

import { startFileMonitor } from '../fileMonitor';

function createMockWatcher(): EventEmitter & { close: jest.Mock } {
    const watcher = new EventEmitter() as EventEmitter & { close: jest.Mock };
    watcher.close = jest.fn();
    return watcher;
}

describe('fileMonitor', () => {
    let mockWatcher: ReturnType<typeof createMockWatcher>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWatcher = createMockWatcher();
        mockWatch.mockReturnValue(mockWatcher);
        mockMkdir.mockResolvedValue(undefined);
    });

    it('creates models directory on startup', async () => {
        await startFileMonitor(jest.fn());
        expect(mockMkdir).toHaveBeenCalledWith('/fake/models', { recursive: true });
    });

    it('watches models directory with correct options', async () => {
        await startFileMonitor(jest.fn());
        expect(mockWatch).toHaveBeenCalledWith('/fake/models', {
            persistent: true,
            ignoreInitial: true,
        });
    });

    it('broadcasts file-size on add event', async () => {
        const broadcast = jest.fn();
        mockStat.mockResolvedValue({ size: 1024 });

        await startFileMonitor(broadcast);
        mockWatcher.emit('add', '/fake/models/test.gguf');
        await new Promise(r => setTimeout(r, 10));

        expect(mockStat).toHaveBeenCalledWith('/fake/models/test.gguf');
        expect(broadcast).toHaveBeenCalledWith({
            type: 'file-size',
            payload: expect.objectContaining({ file: 'test.gguf', size: 1024 }),
        });
    });

    it('broadcasts file-size on change event', async () => {
        const broadcast = jest.fn();
        mockStat.mockResolvedValue({ size: 2048 });

        await startFileMonitor(broadcast);
        mockWatcher.emit('change', '/fake/models/output.gguf');
        await new Promise(r => setTimeout(r, 10));

        expect(broadcast).toHaveBeenCalledWith({
            type: 'file-size',
            payload: expect.objectContaining({ file: 'output.gguf', size: 2048 }),
        });
    });

    it('handles stat errors gracefully', async () => {
        const broadcast = jest.fn();
        mockStat.mockRejectedValue(new Error('ENOENT'));

        await startFileMonitor(broadcast);
        mockWatcher.emit('add', '/fake/models/deleted.gguf');
        await new Promise(r => setTimeout(r, 10));

        // Should not crash, just log warning
        expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'file-size' }));
    });
});
