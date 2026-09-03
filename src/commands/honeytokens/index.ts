import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "honeytokens",
    description: "Manage decoy (canary) relations",
  },
  subCommands: {
    list: generatedLeaf(["honeytokens", "list"]),
    ls: generatedLeaf(["honeytokens", "list"]),
    create: generatedLeaf(["honeytokens", "create"]),
    add: generatedLeaf(["honeytokens", "create"]),
    show: generatedLeaf(["honeytokens", "show"]),
    inspect: generatedLeaf(["honeytokens", "show"]),
    update: generatedLeaf(["honeytokens", "update"]),
    delete: generatedLeaf(["honeytokens", "delete"]),
    rm: generatedLeaf(["honeytokens", "delete"]),
  },
});
