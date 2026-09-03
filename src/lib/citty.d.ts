import type { CommandDocs } from "./flags.js";

declare module "citty" {
  interface CommandMeta {
    /** Documentation metadata used by the generate-cli-docs script. */
    docs?: CommandDocs;
    /** Lucide icon name used as the page icon in generated CLI docs. */
    icon?: string;
  }
}
