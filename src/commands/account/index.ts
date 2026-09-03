import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "account",
    description: "Manage account settings",
  },
  subCommands: {
    export: () => import("./export.js").then((m) => m.default),
  },
});
