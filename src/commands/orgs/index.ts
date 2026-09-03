import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "orgs",
    description: "Manage organizations",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    switch: () => import("./switch.js").then((m) => m.default),
    usage: () => import("./usage.js").then((m) => m.default),
    plan: () => import("./plan.js").then((m) => m.default),
  },
});
