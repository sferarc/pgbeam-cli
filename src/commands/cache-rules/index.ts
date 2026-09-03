import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "cache-rules",
    description: "Manage cache rules for query caching",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    set: () => import("./set.js").then((m) => m.default),
  },
});
