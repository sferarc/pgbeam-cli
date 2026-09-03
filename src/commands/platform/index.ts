import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "platform",
    description: "Regions and health checks",
  },
  subCommands: {
    regions: () => import("../regions.js").then((m) => m.default),
    health: () => import("../health.js").then((m) => m.default),
  },
});
