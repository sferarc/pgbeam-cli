import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "replicas",
    description: "Manage read replicas",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    add: () => import("./add.js").then((m) => m.default),
    create: () => import("./add.js").then((m) => m.default),
    delete: () => import("./delete.js").then((m) => m.default),
    rm: () => import("./delete.js").then((m) => m.default),
  },
});
