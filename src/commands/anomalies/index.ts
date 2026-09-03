import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "anomalies",
    description: "Review anomaly-detection alerts",
  },
  subCommands: {
    list: () => import("./list.js").then((m) => m.default),
    ls: () => import("./list.js").then((m) => m.default),
    ack: () => import("./ack.js").then((m) => m.default),
    acknowledge: () => import("./ack.js").then((m) => m.default),
    resolve: () => import("./resolve.js").then((m) => m.default),
  },
});
