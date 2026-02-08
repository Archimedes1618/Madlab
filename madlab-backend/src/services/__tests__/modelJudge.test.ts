import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

const mockSpawn = jest.fn();
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockBroadcast = jest.fn();
const mockFetchWithTimeout = jest.fn();
const mockEvaluateGGUF = jest.fn();
const mockGenerateGraph = jest.fn();
const mockAppendLineage = jest.fn();

jest.mock('child_process', () => ({ spawn: (...args: any[]) => mockSpawn(...args) }));
jest.mock('fs', () => ({
    promises: {
        readFile: (...args: any[]) => mockReadFile(...args),
        writeFile: (...args: any[]) => mockWriteFile(...args),
    },
}));
jest.mock('../../server', () => ({ broadcast: (...args: any[]) => mockBroadcast(...args) }));
jest.mock('../../utils/fetch', () => ({ fetchWithTimeout: (...args: any[]) => mockFetchWithTimeout(...args) }));
jest.mock('../../config', () => ({
    CONFIG: {
        MODELS_DIR: '/fake/models',
        TRAINER_DIR: '/fake/trainer',
        LM_STUDIO_URL: 'http://localhost:1234',
        LLM_TIMEOUT: 30000,
    },
}));
jest.mock('../ggufEvaluator', () => ({ evaluateGGUF: (...args: any[]) => mockEvaluateGGUF(...args) }));
jest.mock('../visualization', () => ({ generateGraph: (...args: any[]) => mockGenerateGraph(...args) }));
jest.mock('../lineage', () => ({ appendLineage: (...args: any[]) => mockAppendLineage(...args) }));

import { judgeModel } from '../modelJudge';

function createMockProcess(): ChildProcess {
    const proc = new EventEmitter() as ChildProcess;
    proc.stdout = new EventEmitter() as any;
    proc.stderr = new EventEmitter() as any;
    proc.kill = jest.fn();
    return proc;
}

function createStaticReport(overrides = {}) {
    return {
        accuracy: 0.7,
        total_samples: 10,
        correct_samples: 7,
        samples: [
            { input: 'q1', target: 'a1', output: 'a1', correct: true },
            { input: 'q2', target: 'a2', output: 'a2', correct: true },
            { input: 'q3', target: 'a3', output: 'wrong', correct: false },
        ],
        ...overrides,
    };
}

function createLLMResponse(score: number, reason: string) {
    return {
        ok: true,
        json: async () => ({
            choices: [{ message: { content: JSON.stringify({ score, reason }) } }],
        }),
    };
}

describe('modelJudge', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockWriteFile.mockResolvedValue(undefined);
        mockGenerateGraph.mockResolvedValue(undefined);
        mockAppendLineage.mockResolvedValue(undefined);
    });

    it('runs static evaluation first', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/models/test-q4_0-report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport()));
        mockFetchWithTimeout.mockResolvedValue(createLLMResponse(8, 'good'));

        const promise = judgeModel('test', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        await promise;

        expect(mockEvaluateGGUF).toHaveBeenCalledWith('test', 'q4_0', 10);
    });

    it('skips LLM judge for correct samples', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport({
            samples: [
                { input: 'q1', target: 'a1', output: 'a1', correct: true },
                { input: 'q2', target: 'a2', output: 'a2', correct: true },
            ],
        })));

        const promise = judgeModel('model', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        await promise;

        expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });

    it('calls LLM judge for incorrect samples', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport({
            samples: [{ input: 'q1', target: 'a1', output: 'wrong', correct: false }],
        })));
        mockFetchWithTimeout.mockResolvedValue(createLLMResponse(5, 'partial'));

        const promise = judgeModel('model', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        await promise;

        expect(mockFetchWithTimeout).toHaveBeenCalledWith(
            'http://localhost:1234/v1/chat/completions',
            expect.objectContaining({ method: 'POST' }),
            30000
        );
    });

    it('handles LLM judge errors gracefully', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport({
            samples: [{ input: 'q', target: 't', output: 'o', correct: false }],
        })));
        mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

        const promise = judgeModel('model', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        const result = await promise;

        expect(result.samples.some(s => s.judgment.score === 0 && s.judgment.reason === 'Judge Failed')).toBe(true);
    });

    it('throws when no samples in report', async () => {
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify({ accuracy: 0, samples: [] }));

        await expect(judgeModel('model', 'q4_0', 10, 50)).rejects.toThrow('No samples found');
    });

    it('writes judge report to file', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport()));
        mockFetchWithTimeout.mockResolvedValue(createLLMResponse(7, 'ok'));

        const promise = judgeModel('write-test', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        await promise;

        expect(mockWriteFile).toHaveBeenCalledWith(
            expect.stringContaining('write-test-q4_0-judge.json'),
            expect.any(String)
        );
    });

    it('generates graph after judging', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport()));
        mockFetchWithTimeout.mockResolvedValue(createLLMResponse(7, 'ok'));

        const promise = judgeModel('graph-test', 'q4_0', 10, 50);
        setTimeout(() => mockProc.emit('close', 0), 10);
        await promise;

        expect(mockGenerateGraph).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'graph-test' }),
            expect.stringContaining('graph-test-q4_0-graph.png')
        );
    });

    it('returns complete judge report', async () => {
        const mockProc = createMockProcess();
        mockSpawn.mockReturnValue(mockProc);
        mockEvaluateGGUF.mockResolvedValue('/fake/report.json');
        mockReadFile.mockResolvedValue(JSON.stringify(createStaticReport()));
        mockFetchWithTimeout.mockResolvedValue(createLLMResponse(8, 'good'));

        const promise = judgeModel('result-test', 'q4_k_m', 15, 55);
        setTimeout(() => mockProc.emit('close', 0), 10);
        const result = await promise;

        expect(result).toMatchObject({
            model: 'result-test',
            quantization: 'q4_k_m',
            sharpness: 55,
            limit: 15,
        });
        expect(result.average_score).toBeGreaterThan(0);
        expect(result.samples.length).toBeGreaterThan(0);
    });
});
