import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "env",
    description: "Manage environment variables",
  },
  subCommands: {
    pull: () => import("./pull.js").then((m) => m.default),
  },
});
