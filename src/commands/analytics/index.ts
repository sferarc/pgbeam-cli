import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "analytics",
    description: "Metrics, insights, and plans",
  },
  subCommands: {
    metrics: () => import("../metrics.js").then((m) => m.default),
    insights: () => import("../insights.js").then((m) => m.default),
    plans: () => import("../plans.js").then((m) => m.default),
    "spend-limit": () => import("./spend-limit.js").then((m) => m.default),
  },
});
