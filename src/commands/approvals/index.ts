import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "approvals",
    description: "Review and decide held statement approvals",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    approve: () => import("./approve.js").then((m) => m.default),
    reject: () => import("./reject.js").then((m) => m.default),
  },
});
