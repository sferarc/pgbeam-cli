import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "domains",
    description: "Manage custom domains",
  },
  subCommands: {
    list: generatedLeaf(["projects", "domains", "list"]),
    ls: generatedLeaf(["projects", "domains", "list"]),
    add: generatedLeaf(["projects", "domains", "add"]),
    create: generatedLeaf(["projects", "domains", "add"]),
    verify: generatedLeaf(["projects", "domains", "verify"]),
    delete: generatedLeaf(["projects", "domains", "delete"]),
    rm: generatedLeaf(["projects", "domains", "delete"]),
  },
});
