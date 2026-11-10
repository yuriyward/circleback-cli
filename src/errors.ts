/** One stable code per failure; `recovery` is the exact next command when one exists. */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly recovery: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, options: { exitCode?: number; recovery?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.exitCode = options.exitCode ?? EXITS[code] ?? 1;
    this.recovery = options.recovery;
    this.details = options.details;
  }
}
/** 2 usage, 4 auth, 5 retry later (nothing was done; run the same command again). */
const EXITS: Record<string, number> = {
  not_ready: 5,
  recording_timeout: 5,
  recording_too_large: 5,
  throttled: 5,
  unauthorized: 4,
  usage: 2,
};
export const usage = (message: string, recovery = "circleback-cli --help") => new CliError("usage", message, { recovery });
