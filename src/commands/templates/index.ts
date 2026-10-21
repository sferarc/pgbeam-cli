import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "templates",
    description: "Manage pre-approved query templates",
  },
  subCommands: {
    list: generatedLeaf(["templates", "list"]),
    ls: generatedLeaf(["templates", "list"]),
    create: () => import("./create.js").then((m) => m.default),
    add: () => import("./create.js").then((m) => m.default),
    show: generatedLeaf(["templates", "show"]),
    inspect: generatedLeaf(["templates", "show"]),
    update: () => import("./update.js").then((m) => m.default),
    delete: generatedLeaf(["templates", "delete"]),
    rm: generatedLeaf(["templates", "delete"]),
  },
});
