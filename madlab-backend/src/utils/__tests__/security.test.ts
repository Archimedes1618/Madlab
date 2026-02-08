import path from 'path';
import { sanitizePath, isPathSafe, validateFilename, validateHFRepo } from '../security';

describe('sanitizePath', () => {
  const baseDir = '/safe/base';

  describe('valid paths', () => {
    const cases = [
      ['data/file.json', 'data/file.json'],
      ['subdir/nested/file.txt', 'subdir/nested/file.txt'],
      ['file.json', 'file.json'],
      ['deep/nested/path/to/file.txt', 'deep/nested/path/to/file.txt'],
      ['file-with-dashes.txt', 'file-with-dashes.txt'],
      ['file_with_underscores.txt', 'file_with_underscores.txt'],
    ];

    test.each(cases)('allows %s', (input, expected) => {
      expect(sanitizePath(baseDir, input)).toBe(path.resolve(baseDir, expected));
    });
  });

  describe('path traversal attacks', () => {
    const traversalCases = [
      // Basic traversal
      ['../../../etc/passwd', 'unix traversal'],
      ['..\\..\\..\\Windows\\System32', 'windows traversal'],
      ['data/../../../etc/passwd', 'nested unix traversal'],
      ['data\\..\\..\\..\\Windows', 'nested windows traversal'],

      // Absolute paths
      ['/etc/passwd', 'unix absolute'],
      ['C:\\Windows\\System32', 'windows absolute'],
      ['//network/share', 'UNC path'],

      // Mixed separators
      ['..\\../..\\etc/passwd', 'mixed separators'],
      ['data/..\\..\\secret', 'mixed in nested'],

      // Starting with separator after traversal
      ['../../../../../', 'traverse to root'],
    ];

    test.each(traversalCases)('blocks: %s (%s)', (input) => {
      expect(() => sanitizePath(baseDir, input)).toThrow('Path traversal attempt detected');
    });
  });

  describe('encoded/exotic traversal (NOT blocked - document behavior)', () => {
    // These test cases document that url-encoded traversals are NOT blocked
    // by the current implementation. This is intentional documentation -
    // if the app decodes URLs before passing to sanitizePath, these would be dangerous.
    // The current behavior is safe IF inputs are not URL-decoded first.
    const encodedCases = [
      ['..%2f..%2f..%2fetc/passwd', 'url encoded slashes - treated as literal'],
      ['..%5c..%5c..%5cWindows', 'url encoded backslashes - treated as literal'],
      ['%c0%ae%c0%ae/etc/passwd', 'overlong utf-8 - treated as literal'],
      ['....//....//etc', 'multiple dots - not valid traversal'],
      ['...//.../etc', 'triple dots - not valid traversal'],
    ];

    test.each(encodedCases)('%s (%s) stays within base', (input) => {
      // These do NOT escape because they're treated as literal filenames
      const result = sanitizePath(baseDir, input);
      expect(result.startsWith(path.resolve(baseDir))).toBe(true);
    });
  });

  describe('ZIP slip attack vectors', () => {
    // ZIP slip: malicious ZIP entries with paths like ../../../etc/cron.d/backdoor
    const zipSlipCases = [
      ['../../../tmp/evil.sh', 'escape to tmp'],
      ['../../../etc/cron.d/backdoor', 'cron injection'],
      ['../../../root/.ssh/authorized_keys', 'ssh key injection'],
      ['../../.bashrc', 'shell config overwrite'],
      ['../node_modules/.bin/npm', 'npm binary hijack'],
      ['trainer/../../../etc/passwd', 'nested in valid prefix'],
      ['data/../../../tmp/shell', 'data prefix escape'],
    ];

    test.each(zipSlipCases)('blocks ZIP slip: %s (%s)', (input) => {
      expect(() => sanitizePath(baseDir, input)).toThrow('Path traversal attempt detected');
    });
  });

  describe('edge cases', () => {
    test('empty userPath resolves to baseDir', () => {
      // path.resolve(baseDir, '') === baseDir
      expect(sanitizePath(baseDir, '')).toBe(path.resolve(baseDir));
    });

    test('dot resolves to baseDir', () => {
      expect(sanitizePath(baseDir, '.')).toBe(path.resolve(baseDir));
    });

    test('baseDir itself is allowed', () => {
      expect(sanitizePath(baseDir, '')).toBe(path.resolve(baseDir));
    });
  });
});

describe('isPathSafe', () => {
  const base = '/allowed/dir';

  describe('safe paths', () => {
    const safeCases = [
      'data.json',
      'subdir/file.txt',
      'nested/deep/file.json',
      'a/b/c/d/e/f.txt',
      'file-name.txt',
      'file_name.txt',
      '.hidden',
      '.hidden/nested.txt',
    ];

    test.each(safeCases)('%s is safe', (input) => {
      expect(isPathSafe(input, base)).toBe(true);
    });
  });

  describe('unsafe paths', () => {
    const unsafeCases = [
      // Traversal
      ['../escape', 'parent traversal'],
      ['..\\escape', 'windows traversal'],
      ['dir/../../../etc', 'nested traversal'],

      // Absolute paths
      ['/etc/passwd', 'unix absolute'],
      ['C:\\Windows', 'windows absolute'],
      ['//server/share', 'UNC path'],

      // Null bytes (path truncation attacks)
      ['file\x00.json', 'null byte mid'],
      ['file.txt\x00.jpg', 'null byte extension'],
      ['\x00secret', 'null byte start'],

      // Only traversal attempts
      ['..', 'just parent'],
      ['../..', 'multiple parent'],
    ];

    test.each(unsafeCases)('%s is unsafe (%s)', (input) => {
      expect(isPathSafe(input, base)).toBe(false);
    });
  });

  describe('null byte injection', () => {
    // Null bytes can truncate paths in some systems
    const nullByteCases = [
      'file\x00../../etc/passwd',
      'safe.txt\x00',
      '\x00../evil',
      'data/\x00/secret',
    ];

    test.each(nullByteCases)('rejects null byte: %s', (input) => {
      expect(isPathSafe(input, base)).toBe(false);
    });
  });

  describe('boundary conditions', () => {
    test('empty string is safe (resolves to base)', () => {
      expect(isPathSafe('', base)).toBe(true);
    });

    test('single dot is safe', () => {
      expect(isPathSafe('.', base)).toBe(true);
    });

    test('hidden files are safe', () => {
      expect(isPathSafe('.gitignore', base)).toBe(true);
    });
  });
});

describe('validateFilename', () => {
  describe('valid filenames', () => {
    const validNames = [
      'data.jsonl',
      'my-file_123.json',
      'CamelCase.txt',
      '0123.log',
      'a',
      'a'.repeat(255),
      '.hidden',
      'file.tar.gz',
      'name with spaces.txt', // spaces allowed in filename
      'unicode-файл.txt', // unicode allowed
    ];

    test.each(validNames)('accepts: %s', (name) => {
      expect(validateFilename(name)).toBe(true);
    });
  });

  describe('invalid filenames', () => {
    const invalidNames = [
      // Path separators
      ['../secret', 'path traversal'],
      ['file/path', 'forward slash'],
      ['file\\path', 'backslash'],
      ['dir/file.txt', 'directory in name'],

      // Null bytes
      ['file\x00name', 'null byte'],
      ['file.txt\x00.jpg', 'null byte extension trick'],

      // Length violations
      ['', 'empty string'],
      ['a'.repeat(256), 'too long (256)'],
      ['a'.repeat(1000), 'way too long'],
    ];

    test.each(invalidNames)('rejects: %s (%s)', (name) => {
      expect(validateFilename(name)).toBe(false);
    });
  });

  describe('boundary length', () => {
    test('255 chars is valid', () => {
      expect(validateFilename('a'.repeat(255))).toBe(true);
    });

    test('256 chars is invalid', () => {
      expect(validateFilename('a'.repeat(256))).toBe(false);
    });

    test('1 char is valid', () => {
      expect(validateFilename('a')).toBe(true);
    });
  });
});

describe('validateHFRepo', () => {
  describe('valid repos', () => {
    const validRepos = [
      'owner/repo',
      'TinyLlama/TinyLlama-1.1B-Chat',
      'user_name/repo-name',
      'org123/model.v2',
      'a/b',
      'HuggingFaceH4/zephyr-7b-beta',
      'meta-llama/Llama-2-7b-chat-hf',
      'TheBloke/Llama-2-13B-GGUF',
    ];

    test.each(validRepos)('accepts: %s', (repo) => {
      expect(validateHFRepo(repo)).toBe(true);
    });
  });

  describe('invalid repos', () => {
    const invalidRepos = [
      // Format issues
      ['noslash', 'no separator'],
      ['too/many/slashes', 'multiple slashes'],
      ['', 'empty'],
      ['/', 'just slash'],
      ['/leading', 'leading slash'],
      ['trailing/', 'trailing slash'],

      // Traversal attempts
      ['../escape', 'traversal'],
      ['owner/../evil', 'nested traversal'],

      // Invalid characters
      ['has spaces/repo', 'spaces in org'],
      ['owner/has spaces', 'spaces in repo'],
      ['owner!/repo', 'exclamation'],
      ['owner/repo@tag', 'at sign'],
      ['owner/repo#branch', 'hash'],
      ['<script>/repo', 'html injection'],

      // Null bytes
      ['owner\x00/repo', 'null byte'],
    ];

    test.each(invalidRepos)('rejects: %s (%s)', (repo) => {
      expect(validateHFRepo(repo)).toBe(false);
    });
  });
});

describe('platform-specific behaviors', () => {
  // These tests verify behavior matches the platform
  const isWindows = process.platform === 'win32';
  const sep = path.sep;

  test('path separator is platform-appropriate', () => {
    if (isWindows) {
      expect(sep).toBe('\\');
    } else {
      expect(sep).toBe('/');
    }
  });

  test('sanitizePath handles platform separators', () => {
    const base = isWindows ? 'C:\\safe\\base' : '/safe/base';
    const userPath = 'sub/file.txt';
    const result = sanitizePath(base, userPath);
    expect(result).toContain(sep);
  });
});
