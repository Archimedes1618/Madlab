import path from 'path';

/**
 * Validates that a resolved path is within the allowed base directory.
 * Prevents path traversal attacks.
 */
export function sanitizePath(baseDir: string, userPath: string): string {
    const resolved = path.resolve(baseDir, userPath);
    const normalizedBase = path.resolve(baseDir);

    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
        throw new Error('Path traversal attempt detected');
    }

    return resolved;
}

/**
 * Validates HuggingFace repository format (org/repo or user/repo)
 */
export function validateHFRepo(repo: string): boolean {
    // Valid HF repo format: alphanumeric, underscore, hyphen, dot for org and repo name
    // Format: org/repo or user/repo
    return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

/**
 * Validates filename (no path separators allowed)
 */
export function validateFilename(filename: string): boolean {
    // No path separators, no null bytes
    return !filename.includes('/') &&
           !filename.includes('\\') &&
           !filename.includes('\0') &&
           filename.length > 0 &&
           filename.length < 256;
}

/**
 * Check if path stays within allowed base directory.
 * Uses path.resolve() to handle traversal attempts like "config/../../../etc/passwd"
 */
export function isPathSafe(userPath: string, allowedBase: string): boolean {
    // Reject absolute paths and obvious traversal
    if (path.isAbsolute(userPath) || userPath.includes('\0')) return false;
    
    // Resolve both paths to absolute form for comparison
    const resolvedBase = path.resolve(allowedBase);
    const resolvedPath = path.resolve(allowedBase, userPath);
    
    // Path must start with base directory
    return resolvedPath === resolvedBase || resolvedPath.startsWith(resolvedBase + path.sep);
}
