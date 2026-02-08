const mockStat = jest.fn();
const mockReadFile = jest.fn();

jest.mock('fs/promises', () => ({
  stat: (...args: any[]) => mockStat(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
}));

jest.mock('../../config', () => ({
  CONFIG: { INSTILLATIONS_PATH: '/fake/instillations.json' },
}));

describe('instillationsCache', () => {
  const mockData = { version: '1.0', pairs: [{ input: 'a', output: 'b' }] };

  beforeEach(() => {
    jest.resetModules();
    mockStat.mockReset();
    mockReadFile.mockReset();
  });

  describe('getInstillations', () => {
    it('reads file on first call', async () => {
      mockStat.mockResolvedValue({ mtimeMs: 1000 });
      mockReadFile.mockResolvedValue(JSON.stringify(mockData));

      const { getInstillations } = await import('../instillationsCache');
      const result = await getInstillations();

      expect(mockReadFile).toHaveBeenCalledWith('/fake/instillations.json', 'utf-8');
      expect(result).toEqual(mockData);
    });

    it('returns cached data when mtime unchanged', async () => {
      mockStat.mockResolvedValue({ mtimeMs: 1000 });
      mockReadFile.mockResolvedValue(JSON.stringify(mockData));

      const { getInstillations } = await import('../instillationsCache');
      await getInstillations();
      mockReadFile.mockClear();
      await getInstillations();

      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('re-reads file when mtime changes', async () => {
      mockStat.mockResolvedValueOnce({ mtimeMs: 1000 });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(mockData));

      const { getInstillations } = await import('../instillationsCache');
      await getInstillations();

      const newData = { version: '2.0', pairs: [] };
      mockStat.mockResolvedValueOnce({ mtimeMs: 2000 });
      mockReadFile.mockResolvedValueOnce(JSON.stringify(newData));

      const result = await getInstillations();
      expect(result).toEqual(newData);
    });

    it('returns default on file error', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const { getInstillations } = await import('../instillationsCache');
      const result = await getInstillations();

      expect(result).toEqual({ version: '1.0', pairs: [] });
    });
  });

  describe('invalidateCache', () => {
    it('forces re-read on next call', async () => {
      mockStat.mockResolvedValue({ mtimeMs: 1000 });
      mockReadFile.mockResolvedValue(JSON.stringify(mockData));

      const { getInstillations, invalidateCache } = await import('../instillationsCache');
      await getInstillations();
      mockReadFile.mockClear();

      invalidateCache();
      await getInstillations();

      expect(mockReadFile).toHaveBeenCalled();
    });
  });
});
