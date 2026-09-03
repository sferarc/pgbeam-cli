import type { ArgsDef } from "citty";

/** Documentation metadata embedded in each command for auto-generated docs. */
export interface CommandDocs {
  /** Extended description shown below the title in the generated MDX page. */
  longDescription: string;
  /** Usage examples as an array of { comment, command } pairs. */
  examples: { comment: string; command: string }[];
  /** What the user should expect as output. */
  response: string;
}

export const globalArgs = {
  token: {
    type: "string",
    description: "API token (overrides profile)",
  },
  profile: {
    type: "string",
    description: "Auth profile to use",
  },
  project: {
    type: "string",
    description: "Project ID (overrides linked project)",
  },
  org: {
    type: "string",
    description: "Organization ID (overrides profile org)",
  },
  json: {
    type: "boolean",
    description: "Output as JSON",
    default: false,
  },
  "no-color": {
    type: "boolean",
    description: "Disable color output",
    default: false,
  },
  debug: {
    type: "boolean",
    description: "Enable debug output",
    default: false,
  },
  trunc: {
    type: "boolean",
    description: "Truncate wide table cells with an ellipsis",
    negativeDescription: "Show full table cell values without truncation",
    default: true,
  },
} as const satisfies ArgsDef;

export type GlobalArgs = {
  token?: string;
  profile?: string;
  project?: string;
  org?: string;
  json: boolean;
  "no-color": boolean;
  debug: boolean;
  trunc?: boolean;
};
