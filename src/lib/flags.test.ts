import { describe, expect, it } from "vitest";
import { type GlobalArgs, globalArgs } from "./flags";

// ---------------------------------------------------------------------------
// globalArgs definition
// ---------------------------------------------------------------------------
describe("globalArgs", () => {
  it("is defined as a non-empty object", () => {
    expect(globalArgs).toBeDefined();
    expect(typeof globalArgs).toBe("object");
    expect(Object.keys(globalArgs).length).toBeGreaterThan(0);
  });

  it("defines a 'token' arg of type string", () => {
    expect(globalArgs.token).toBeDefined();
    expect(globalArgs.token.type).toBe("string");
    expect(globalArgs.token.description).toBeDefined();
  });

  it("defines a 'profile' arg of type string", () => {
    expect(globalArgs.profile).toBeDefined();
    expect(globalArgs.profile.type).toBe("string");
    expect(globalArgs.profile.description).toBeDefined();
  });

  it("defines a 'project' arg of type string", () => {
    expect(globalArgs.project).toBeDefined();
    expect(globalArgs.project.type).toBe("string");
    expect(globalArgs.project.description).toBeDefined();
  });

  it("defines an 'org' arg of type string", () => {
    expect(globalArgs.org).toBeDefined();
    expect(globalArgs.org.type).toBe("string");
    expect(globalArgs.org.description).toBeDefined();
  });

  it("defines a 'json' boolean arg defaulting to false", () => {
    expect(globalArgs.json).toBeDefined();
    expect(globalArgs.json.type).toBe("boolean");
    expect(globalArgs.json.default).toBe(false);
  });

  it("defines a 'no-color' boolean arg defaulting to false", () => {
    expect(globalArgs["no-color"]).toBeDefined();
    expect(globalArgs["no-color"].type).toBe("boolean");
    expect(globalArgs["no-color"].default).toBe(false);
  });

  it("defines a 'debug' boolean arg defaulting to false", () => {
    expect(globalArgs.debug).toBeDefined();
    expect(globalArgs.debug.type).toBe("boolean");
    expect(globalArgs.debug.default).toBe(false);
  });

  it("has descriptions for all args", () => {
    for (const [_key, def] of Object.entries(globalArgs)) {
      expect(def.description).toBeTruthy();
    }
  });

  it("defines a 'trunc' boolean arg defaulting to true (negated by --no-trunc)", () => {
    expect(globalArgs.trunc).toBeDefined();
    expect(globalArgs.trunc.type).toBe("boolean");
    expect(globalArgs.trunc.default).toBe(true);
    expect(globalArgs.trunc.negativeDescription).toBeTruthy();
  });

  it("contains exactly the expected keys", () => {
    const keys = Object.keys(globalArgs).sort();
    expect(keys).toEqual(
      ["debug", "json", "no-color", "org", "profile", "project", "token", "trunc"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// GlobalArgs type shape (compile-time checked, but also runtime-verifiable)
// ---------------------------------------------------------------------------
describe("GlobalArgs type compatibility", () => {
  it("accepts a valid GlobalArgs object", () => {
    const args: GlobalArgs = {
      json: false,
      "no-color": false,
      debug: false,
    };

    // These are required boolean fields with defaults
    expect(args.json).toBe(false);
    expect(args["no-color"]).toBe(false);
    expect(args.debug).toBe(false);
  });

  it("accepts optional string fields", () => {
    const args: GlobalArgs = {
      token: "tok-123",
      profile: "ci",
      project: "proj-1",
      org: "org-1",
      json: true,
      "no-color": true,
      debug: true,
    };

    expect(args.token).toBe("tok-123");
    expect(args.profile).toBe("ci");
    expect(args.project).toBe("proj-1");
    expect(args.org).toBe("org-1");
  });
});
