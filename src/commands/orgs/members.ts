import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "members",
    description: "Manage who belongs to an organization, and what they can do",
  },
  subCommands: {
    list: generatedLeaf(["orgs", "members", "list"]),
    ls: generatedLeaf(["orgs", "members", "list"]),
    "set-role": generatedLeaf(["orgs", "members", "set-role"]),
    remove: generatedLeaf(["orgs", "members", "remove"]),
  },
});
