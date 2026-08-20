/**
 * Every failure the vault layer can produce, as a typed code. Route handlers map
 * these to HTTP status without stringly-typed guessing, and the UI can branch on
 * `code` rather than parsing messages.
 */
export type VaultErrorCode =
  | "invalid_slug"
  | "invalid_filename"
  | "escapes_root"
  | "not_found"
  | "conflict"
  | "already_exists"
  | "invalid_document"
  /**
   * A connected repository path that cannot be used: not absolute, missing, not a
   * directory, or nested with the vault. Separate from `invalid_document` because the
   * user can fix it by choosing a different directory, and separate from `not_found`
   * because the project itself is fine — only its repo link is broken.
   */
  | "invalid_repo";

const STATUS: Record<VaultErrorCode, number> = {
  invalid_slug: 400,
  invalid_filename: 400,
  escapes_root: 400,
  not_found: 404,
  conflict: 409,
  already_exists: 409,
  invalid_document: 422,
  invalid_repo: 400,
};

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function isVaultError(e: unknown): e is VaultError {
  return e instanceof VaultError;
}
