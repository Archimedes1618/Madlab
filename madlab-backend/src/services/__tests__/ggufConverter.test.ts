import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

let mockSpawn: jest.Mock;
let mockMkdir: jest.Mock;
let mockAccess: jest.Mock;
let mockBroadcast: jest.Mock;
let mockAppendLineage: jest.Mock;

jest.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));
jest.mock('fs', () => ({
    promises: {
        mkdir: (...args: any[]) => mockMkdir(...args),
        access: (...args: any[]) => mockAccess(...args),
    },
}));
jest.mock('../../server', () => ({
    broadcast: (...args: any[]) => mockBroadcast(...args),
}));
jest.mock('../../config', () => ({
    CONFIG: { MODELS_DIR: '/fake/models', TRAINER_DIR: '/fake/trainer' },
    getPythonPath: () => 'python3',
}));
jest.mock('../lineage', () => ({
    appendLineage: (...args: any[]) => mockAppendLineage(...args),
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

describe('ggufConverter', () => {
    beforeEach(() => {
        jest.resetModules();
        mockSpawn = jest.fn();
        mockMkdir = jest.fn().mockResolvedValue(undefined);
        mockAccess = jest.fn().mockResolvedValue(undefined);
        mockBroadcast = jest.fn();
        mockAppendLineage = jest.fn().mockResolvedValue(undefined);
    });

    it('creates models directory and spawns converter', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { convertToGGUF } = await import('../ggufConverter');
        const promise = convertToGGUF({ modelName: 'test', quantization: 'q4_0' });

        await tick(); // Wait for mkdir to complete

        expect(mockMkdir).toHaveBeenCalledWith('/fake/models', { recursive: true });
        expect(mockSpawn).toHaveBeenCalledWith('python3', expect.any(Array), expect.any(Object));

        mockProc.emit('close', 0);
        await promise;
    });

    it('broadcasts status on start and completion', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { convertToGGUF } = await import('../ggufConverter');
        const promise = convertToGGUF({ modelName: 'model', quantization: 'q4_0' });

        expect(mockBroadcast).toHaveBeenCalledWith({
            type: 'status',
            payload: { message: 'Converting model to q4_0...' },
        });

        await tick();
        mockProc.emit('close', 0);
        await promise;

        expect(mockBroadcast).toHaveBeenCalledWith({
            type: 'status',
            payload: { message: 'Conversion complete: model-q4_0.gguf' },
        });
    });

    it('appends lineage on success', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { convertToGGUF } = await import('../ggufConverter');
        const promise = convertToGGUF({ modelName: 'lineage', quantization: 'q5_k_m' });

        await tick();
        mockProc.emit('close', 0);
        await promise;

        expect(mockAppendLineage).toHaveBeenCalledWith('lineage', 'gguf_conversion', expect.any(Object));
    });

    it('rejects on non-zero exit code', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { convertToGGUF } = await import('../ggufConverter');
        const promise = convertToGGUF({ modelName: 'fail', quantization: 'q4_0' });

        await tick();
        mockProc.emit('close', 1);
        await expect(promise).rejects.toThrow('Conversion failed with code 1');
    });

    it('rejects on spawn error', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);

        const { convertToGGUF } = await import('../ggufConverter');
        const promise = convertToGGUF({ modelName: 'error', quantization: 'q4_0' });

        await tick();
        mockProc.emit('error', new Error('spawn ENOENT'));
        await expect(promise).rejects.toThrow('Failed to spawn converter');
    });

    it('rejects if converter script not found', async () => {
        mockAccess.mockRejectedValue(new Error('ENOENT'));

        const { convertToGGUF } = await import('../ggufConverter');
        await expect(convertToGGUF({ modelName: 'missing', quantization: 'q4_0' }))
            .rejects.toThrow('Converter script not found');
    });
});
