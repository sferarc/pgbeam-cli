import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "policies",
    description: "Manage agent policy profiles",
  },
  subCommands: {
    list: generatedLeaf(["policies", "list"]),
    ls: generatedLeaf(["policies", "list"]),
    show: generatedLeaf(["policies", "show"]),
    inspect: generatedLeaf(["policies", "show"]),
    create: () => import("./create.js").then((m) => m.default),
    update: () => import("./update.js").then((m) => m.default),
    "dry-eval": () => import("./dry-eval.js").then((m) => m.default),
    lint: () => import("./lint.js").then((m) => m.default),
    replay: () => import("./replay.js").then((m) => m.default),
    delete: generatedLeaf(["policies", "delete"]),
    rm: generatedLeaf(["policies", "delete"]),
  },
});
