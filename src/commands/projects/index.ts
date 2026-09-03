import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "projects",
    description: "Manage projects",
  },
  subCommands: {
    list: generatedLeaf(["projects", "list"]),
    ls: generatedLeaf(["projects", "list"]),
    create: () => import("./create.js").then((m) => m.default),
    inspect: generatedLeaf(["projects", "inspect"]),
    show: generatedLeaf(["projects", "inspect"]),
    update: () => import("./update.js").then((m) => m.default),
    delete: generatedLeaf(["projects", "delete"]),
    usage: () => import("./usage.js").then((m) => m.default),
    link: () => import("../link.js").then((m) => m.default),
    unlink: () => import("../unlink.js").then((m) => m.default),
    domains: () => import("../domains/index.js").then((m) => m.default),
    replicas: () => import("../replicas/index.js").then((m) => m.default),
    "cache-rules": () => import("../cache-rules/index.js").then((m) => m.default),
    env: () => import("../env/index.js").then((m) => m.default),
  },
});
