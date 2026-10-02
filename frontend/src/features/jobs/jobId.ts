const JOB_ID_PATTERN =
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonical 8-4-4-4-12 hyphenated hexadecimal UUID shape, case-insensitive.
 * The input is never trimmed: any surrounding character, including
 * whitespace, invalidates the identifier so malformed job IDs can never
 * reach the backend as a detail request.
 */
export function isValidJobId(jobId: string): boolean {
 return JOB_ID_PATTERN.test(jobId);
}
