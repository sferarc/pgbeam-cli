import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "migrations",
    description: "Lint migrations for unsafe DDL",
  },
  subCommands: {
    lint: () => import("./lint.js").then((m) => m.default),
  },
});
