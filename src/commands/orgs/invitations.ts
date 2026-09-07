import { defineCommand } from "citty";
import { generatedLeaf } from "../../lib/generated-command.js";

export default defineCommand({
  meta: {
    name: "invitations",
    description: "Invite people to an organization and manage pending invitations",
  },
  subCommands: {
    list: generatedLeaf(["orgs", "invitations", "list"]),
    ls: generatedLeaf(["orgs", "invitations", "list"]),
    create: generatedLeaf(["orgs", "invitations", "create"]),
    invite: generatedLeaf(["orgs", "invitations", "create"]),
    revoke: generatedLeaf(["orgs", "invitations", "revoke"]),
  },
});
