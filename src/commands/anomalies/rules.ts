import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "rules",
    description: "Tune anomaly-detection sensitivity per project or credential",
  },
  subCommands: {
    list: generatedLeaf(["anomalies", "rules", "list"]),
    ls: generatedLeaf(["anomalies", "rules", "list"]),
    create: generatedLeaf(["anomalies", "rules", "create"]),
    add: generatedLeaf(["anomalies", "rules", "create"]),
    show: generatedLeaf(["anomalies", "rules", "show"]),
    inspect: generatedLeaf(["anomalies", "rules", "show"]),
    update: generatedLeaf(["anomalies", "rules", "update"]),
    delete: generatedLeaf(["anomalies", "rules", "delete"]),
    rm: generatedLeaf(["anomalies", "rules", "delete"]),
  },
});
