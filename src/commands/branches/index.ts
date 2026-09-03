import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "branches",
    description: "Manage ephemeral database sandbox branches",
  },
  subCommands: {
    list: generatedLeaf(["branches", "list"]),
    ls: generatedLeaf(["branches", "list"]),
    discard: generatedLeaf(["branches", "discard"]),
    rm: generatedLeaf(["branches", "discard"]),
  },
});
