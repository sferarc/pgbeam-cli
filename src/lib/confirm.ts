import { confirm, input } from "@inquirer/prompts";

/**
 * Thrown when a destructive command cannot prompt for confirmation because
 * stdin is not a TTY (e.g. CI, piped input) and `--yes` was not passed. The
 * message tells the caller how to proceed safely; it is surfaced by
 * `runCommand` and exits non-zero. We refuse rather than auto-confirm.
 */
export class ConfirmationRequiredError extends Error {
  constructor(action: string) {
    super(
      `${action} requires confirmation. Re-run with --yes to confirm in a non-interactive environment.`,
    );
    this.name = "ConfirmationRequiredError";
  }
}

/**
 * Thrown when a name-match confirmation is requested but stdin is not a TTY.
 * High-stakes commands cannot fall back to `--yes` alone for the typed check.
 */
export class ConfirmationMismatchError extends Error {
  constructor(action: string) {
    super(`${action} aborted: the typed value did not match.`);
    this.name = "ConfirmationMismatchError";
  }
}

/** Indicates the user declined an interactive confirmation prompt. */
export class ConfirmationDeclinedError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "ConfirmationDeclinedError";
  }
}

export interface ConfirmOptions {
  /** Skip the prompt entirely (the `--yes`/`-y` flag). */
  yes: boolean;
  /**
   * One-line description of what will be destroyed, e.g.
   * `Delete project prj_123? This cannot be undone.`
   */
  message: string;
  /**
   * For high-stakes operations: require the user to type this exact value
   * (e.g. the resource name/ID) to proceed. `--yes` bypasses it for scripting,
   * matching the dashboard Danger Zone which only enforces the typed match in
   * the interactive flow.
   */
  requireMatch?: string;
  /**
   * Short label used in error messages when confirmation can't be obtained,
   * e.g. "Revoke" or "Delete". Defaults to "This action".
   */
  action?: string;
  /**
   * Override TTY detection (for tests). When undefined, falls back to
   * `process.stdin.isTTY`.
   */
  isTTY?: boolean;
}

function resolveTTY(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  return Boolean(process.stdin.isTTY);
}

/**
 * Gate a destructive action behind confirmation. Returns when the action is
 * confirmed; throws otherwise. Behaviour:
 *
 * - `--yes` → proceeds immediately (no prompt), even for name-match commands.
 * - Interactive TTY → prompts (`confirm`, or a typed name-match `input`).
 * - Non-interactive (no TTY) without `--yes` → throws `ConfirmationRequiredError`
 *   so the command fails safely instead of hanging or auto-confirming.
 *
 * The thrown errors are caught by `runCommand`, which prints the message and
 * exits non-zero.
 */
export async function confirmDestructive(opts: ConfirmOptions): Promise<void> {
  const action = opts.action ?? "This action";

  if (opts.yes) return;

  if (!resolveTTY(opts.isTTY)) {
    throw new ConfirmationRequiredError(action);
  }

  if (opts.requireMatch !== undefined) {
    const typed = await input({
      message: `${opts.message}\n  Type "${opts.requireMatch}" to confirm:`,
    });
    if (typed.trim() !== opts.requireMatch) {
      throw new ConfirmationMismatchError(action);
    }
    return;
  }

  const ok = await confirm({ message: opts.message, default: false });
  if (!ok) {
    throw new ConfirmationDeclinedError();
  }
}
