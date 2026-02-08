import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

let mockSpawn: jest.Mock;
let mockMkdir: jest.Mock;
let mockExistsSync: jest.Mock;
let mockBroadcast: jest.Mock;

jest.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));
jest.mock('fs', () => ({
    existsSync: (...args: any[]) => mockExistsSync(...args),
    promises: {
        mkdir: (...args: any[]) => mockMkdir(...args),
    },
}));
jest.mock('../../server', () => ({
    broadcast: (...args: any[]) => mockBroadcast(...args),
}));
jest.mock('../../config', () => ({
    CONFIG: { MODELS_DIR: '/fake/models', TRAINER_DIR: '/fake/trainer', DATA_DIR: '/fake/data' },
    getPythonPath: () => 'python3',
}));

function createMockProcess(): ChildProcess {
    const proc = new EventEmitter() as ChildProcess;
    proc.stdout = new EventEmitter() as any;
    proc.stderr = new EventEmitter() as any;
    proc.kill = jest.fn();
    return proc;
}

// Helper to flush microtask queue
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('ggufEvaluator', () => {
    beforeEach(() => {
        jest.resetModules();
        mockSpawn = jest.fn();
        mockMkdir = jest.fn().mockResolvedValue(undefined);
        mockExistsSync = jest.fn().mockReturnValue(true);
        mockBroadcast = jest.fn();
    });

    it('creates models directory and spawns evaluator', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { evaluateGGUF } = await import('../ggufEvaluator');
        const promise = evaluateGGUF('test', 'q4_0', 1.0);

        await tick();

        expect(mockMkdir).toHaveBeenCalledWith('/fake/models', { recursive: true });
        expect(mockSpawn).toHaveBeenCalledWith('python3', expect.any(Array), expect.any(Object));

        mockProc.emit('close', 0);
        await promise;
    });

    it('broadcasts status and returns report path', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { evaluateGGUF } = await import('../ggufEvaluator');
        const promise = evaluateGGUF('result', 'q4_0', 1.0);

        expect(mockBroadcast).toHaveBeenCalledWith({
            type: 'status',
            payload: { message: 'Evaluating result-q4_0...' },
        });

        await tick();
        mockProc.emit('close', 0);
        const result = await promise;
        expect(result).toContain('result-q4_0-report.json');
    });

    it('rejects on non-zero exit code', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { evaluateGGUF } = await import('../ggufEvaluator');
        const promise = evaluateGGUF('fail', 'q4_0', 1.0);

        await tick();
        mockProc.emit('close', 2);
        await expect(promise).rejects.toThrow('Evaluation failed with code 2');
    });

    it('rejects on spawn error', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { evaluateGGUF } = await import('../ggufEvaluator');
        const promise = evaluateGGUF('error', 'q4_0', 1.0);

        await tick();
        mockProc.emit('error', new Error('spawn ENOENT'));
        await expect(promise).rejects.toThrow('Failed to spawn evaluator');
    });
});
