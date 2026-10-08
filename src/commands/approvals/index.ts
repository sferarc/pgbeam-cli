import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "approvals",
    description: "Review held statement approvals and author the rules that hold them",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    approve: () => import("./approve.js").then((m) => m.default),
    reject: () => import("./reject.js").then((m) => m.default),
    rules: () => import("./rules.js").then((m) => m.default),
  },
});
