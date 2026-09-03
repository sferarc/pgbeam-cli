import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "agents",
    description: "Manage AI agent credentials",
  },
  subCommands: {
    list: generatedLeaf(["agents", "list"]),
    ls: generatedLeaf(["agents", "list"]),
    show: generatedLeaf(["agents", "show"]),
    get: generatedLeaf(["agents", "show"]),
    inspect: () => import("./inspect.js").then((m) => m.default),
    create: () => import("./create.js").then((m) => m.default),
    "mcp-config": () => import("./mcp-config.js").then((m) => m.default),
    rotate: () => import("./rotate.js").then((m) => m.default),
    revoke: generatedLeaf(["agents", "revoke"]),
    rm: generatedLeaf(["agents", "revoke"]),
    disable: () => import("./disable.js").then((m) => m.default),
    enable: () => import("./enable.js").then((m) => m.default),
    "recommend-policy": generatedLeaf(["agents", "recommend-policy"]),
    "right-size": generatedLeaf(["agents", "recommend-policy"]),
    usage: () => import("./usage.js").then((m) => m.default),
  },
});
