import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "webhooks",
    description: "Manage event/audit webhook endpoints",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    create: () => import("./create.js").then((m) => m.default),
    show: () => import("./show.js").then((m) => m.default),
    inspect: () => import("./show.js").then((m) => m.default),
    update: () => import("./update.js").then((m) => m.default),
    delete: () => import("./delete.js").then((m) => m.default),
    rm: () => import("./delete.js").then((m) => m.default),
    test: () => import("./test.js").then((m) => m.default),
  },
});
