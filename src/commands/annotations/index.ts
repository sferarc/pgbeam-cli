import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "annotations",
    description: "Describe tables and columns for connected agents",
  },
  subCommands: {
    list: generatedLeaf(["annotations", "list"]),
    ls: generatedLeaf(["annotations", "list"]),
    set: generatedLeaf(["annotations", "set"]),
    delete: generatedLeaf(["annotations", "delete"]),
    rm: generatedLeaf(["annotations", "delete"]),
  },
});
