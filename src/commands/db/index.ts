import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "db",
    description: "Manage databases",
  },
  subCommands: {
    list: generatedLeaf(["db", "list"]),
    ls: generatedLeaf(["db", "list"]),
    add: () => import("./add.js").then((m) => m.default),
    create: () => import("./add.js").then((m) => m.default),
    inspect: generatedLeaf(["db", "inspect"]),
    show: generatedLeaf(["db", "inspect"]),
    update: () => import("./update.js").then((m) => m.default),
    delete: generatedLeaf(["db", "delete"]),
    rm: generatedLeaf(["db", "delete"]),
    test: generatedLeaf(["db", "test"]),
    "scan-pii": generatedLeaf(["db", "scan-pii"]),
    "schema-catalog": generatedLeaf(["db", "schema-catalog"]),
  },
});
