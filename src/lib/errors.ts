import { consola } from "consola";
import { ConfirmationDeclinedError } from "./confirm.js";
import { outputJson } from "./output.js";

/** A short remediation hint for common API error status codes. */
export function remediationHint(status: number): string | undefined {
  if (status === 401) {
    return "Not authenticated or the token is invalid. Run `pgbeam auth login`, or pass --token / set PGBEAM_API_KEY. Create a key at https://dash.pgbeam.com/settings/account/api-keys.";
  }
  if (status === 403) {
    return "Permission denied. Check the active profile and organization (`pgbeam auth status`) and that the token has access to this project.";
  }
  if (status === 404) {
    return "Not found. Check the resource ID and the linked project (`pgbeam link`, or pass --project).";
  }
  if (status === 429) {
    return "Rate limited. Wait a moment and retry, or reduce request frequency.";
  }
  if (status >= 500) {
    return "The API had a server-side problem. Retry shortly; if it persists, contact support.";
  }
  return undefined;
}

/** The machine-parseable error object printed to stdout under --json. */
interface JsonError {
  error: {
    status?: number;
    message: string;
    hint?: string;
  };
}

/**
 * Whether errors should be emitted as JSON. Read from argv at call time (like
 * table truncation) because it is a pure output concern shared by every
 * command; runCommand has no access to the parsed args.
 */
function jsonOutputEnabled(): boolean {
  return process.argv.includes("--json");
}

interface DescribedFailure {
  status?: number;
  message: string;
  hint?: string;
  /** Parsed response body, when the error carried one (SDK ApiError, rawRequest). */
  body?: unknown;
}

function describeFailure(err: unknown): DescribedFailure {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;
    const message =
      err instanceof Error ? err.message : ((err as { message?: unknown }).message ?? String(err));
    const body = "body" in err ? (err as { body?: unknown }).body : undefined;
    return {
      status,
      message: String(message),
      hint: remediationHint(status),
      ...(body !== null && body !== undefined ? { body } : {}),
    };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}

/**
 * Whether the response body adds anything beyond the already-printed message.
 * An `{ error: { message } }` or `{ message }` envelope whose only content is
 * the message would just repeat the error line.
 */
function bodyAddsDetail(body: unknown, message: string): boolean {
  if (typeof body !== "object" || body === null) {
    return typeof body === "string" && body.trim().length > 0 && body !== message;
  }
  const record = body as Record<string, unknown>;
  const inner =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const keys = Object.keys(inner);
  return keys.some((k) => k !== "message" || inner[k] !== message);
}

/** Wrap a command body to catch SDK/API errors and print clean messages. */
export async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // A user declining an interactive confirmation is a clean cancel, not a
    // failure: print an info message and exit zero.
    if (err instanceof ConfirmationDeclinedError) {
      consola.info(err.message);
      return;
    }
    // `@inquirer/prompts` throws `ExitPromptError` when the user aborts a prompt
    // with Ctrl-C. Treat it as a clean cancel too.
    if (err instanceof Error && err.name === "ExitPromptError") {
      consola.info("Cancelled.");
      return;
    }

    const failure = describeFailure(err);

    if (jsonOutputEnabled()) {
      // Machine-parseable error object on stdout, so `--json` pipelines see
      // structured output on the error path too. Exit code still signals failure.
      const jsonError: JsonError = {
        error: {
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          message: failure.message,
          ...(failure.hint ? { hint: failure.hint } : {}),
        },
      };
      outputJson(jsonError);
      process.exit(1);
    }

    if (failure.status !== undefined) {
      consola.error(`API error (${failure.status}): ${failure.message}`);
      if (failure.body !== undefined && bodyAddsDetail(failure.body, failure.message)) {
        consola.log(
          typeof failure.body === "string" ? failure.body : JSON.stringify(failure.body, null, 2),
        );
      }
      if (failure.hint) consola.info(failure.hint);
    } else {
      consola.error(failure.message);
    }
    process.exit(1);
  }
}
