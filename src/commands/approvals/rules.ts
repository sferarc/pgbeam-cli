import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "rules",
    description: "Author rules that send matching agent statements to a human",
  },
  subCommands: {
    list: generatedLeaf(["approvals", "rules", "list"]),
    ls: generatedLeaf(["approvals", "rules", "list"]),
    create: generatedLeaf(["approvals", "rules", "create"]),
    add: generatedLeaf(["approvals", "rules", "create"]),
    show: generatedLeaf(["approvals", "rules", "show"]),
    inspect: generatedLeaf(["approvals", "rules", "show"]),
    update: generatedLeaf(["approvals", "rules", "update"]),
    delete: generatedLeaf(["approvals", "rules", "delete"]),
    rm: generatedLeaf(["approvals", "rules", "delete"]),
  },
});
