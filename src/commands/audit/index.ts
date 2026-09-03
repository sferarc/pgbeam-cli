import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "audit",
    description: "View agent statement audit logs",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    export: () => import("./export.js").then((m) => m.default),
    session: () => import("./session.js").then((m) => m.default),
    verify: generatedLeaf(["audit", "verify"]),
  },
});
