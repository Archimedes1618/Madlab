import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

let mockSpawn: jest.Mock;
let mockBroadcast: jest.Mock;
let mockExistsSync: jest.Mock;
let mockReadFileSync: jest.Mock;
let mockWriteFileSync: jest.Mock;
let mockLoggerInfo: jest.Mock;
let mockLoggerError: jest.Mock;

jest.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));
jest.mock('fs', () => ({
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));
jest.mock('../../server', () => ({
    broadcast: (...args: any[]) => mockBroadcast(...args),
}));
jest.mock('../../config', () => ({
    CONFIG: { TRAINER_DIR: '/fake/trainer', DATA_DIR: '/fake/data' },
    getPythonPath: () => 'python3',
}));
jest.mock('../../utils/logger', () => ({
    logger: {
        info: (...args: any[]) => mockLoggerInfo?.(...args),
        error: (...args: any[]) => mockLoggerError?.(...args),
    },
}));

function createMockProcess(): ChildProcess {
    const proc = new EventEmitter() as ChildProcess;
    proc.stdout = new EventEmitter() as any;
    proc.stderr = new EventEmitter() as any;
    proc.kill = jest.fn();
    Object.defineProperty(proc, 'pid', { value: 12345, writable: false });
    return proc;
}

describe('processManager', () => {
    beforeEach(() => {
        jest.resetModules();
        mockSpawn = jest.fn();
        mockBroadcast = jest.fn();
        mockExistsSync = jest.fn().mockReturnValue(false);
        mockReadFileSync = jest.fn();
        mockWriteFileSync = jest.fn();
        mockLoggerInfo = jest.fn();
        mockLoggerError = jest.fn();
    });

    it('spawns process with correct args', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { startTraining } = await import('../processManager');
        await startTraining('config.yaml');

        expect(mockSpawn).toHaveBeenCalledWith(
            'python3',
            expect.arrayContaining(['--config']),
            expect.objectContaining({ cwd: '/fake/trainer' })
        );
    });

    it('throws if training already in progress', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { startTraining } = await import('../processManager');
        await startTraining('config.yaml');

        await expect(startTraining('config2.yaml')).rejects.toThrow(/Training already/);
    });

    it('kills running process on stop', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { startTraining, stopTraining } = await import('../processManager');
        await startTraining('config.yaml');

        // stopTraining is async and waits for exit
        const stopPromise = stopTraining();
        mockProc.emit('exit', 0);
        await stopPromise;

        expect(mockProc.kill).toHaveBeenCalled();
    });

    it('getStatus returns running:true when process exists', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { startTraining, getStatus } = await import('../processManager');
        await startTraining('config.yaml');

        expect(getStatus()).toEqual({ running: true, pid: 12345 });
    });
});
