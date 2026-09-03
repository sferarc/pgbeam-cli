import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "api",
    description: "Interact with the PgBeam API directly",
  },
  subCommands: {
    ls: () => import("./ls.js").then((m) => m.default),
    list: () => import("./ls.js").then((m) => m.default),
    request: () => import("./request.js").then((m) => m.default),
    schema: () => import("./schema.js").then((m) => m.default),
  },
});
