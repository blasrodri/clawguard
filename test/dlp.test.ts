import { describe, expect, it } from "vitest";
import { Detectors, scan } from "../src/core/dlp.js";

describe("dlp.scan", () => {
  it("detects email", () => {
    expect(scan("contact: john.doe+work@example.co.uk now")).toContain("email");
  });

  it("detects a separator-shaped phone number", () => {
    expect(scan("call me at +1 555 123 4567 tomorrow")).toContain("phone");
  });

  it("does not flag token-count JSON as a phone number", () => {
    const hits = scan(`{"ts_ns":1234567890,"pid":1989578,"input_tokens":554,"output_tokens":300}`);
    expect(hits).not.toContain("phone");
  });

  it("detects a Luhn-valid credit card", () => {
    expect(scan("payment: 4111 1111 1111 1111 expires 12/30")).toContain("credit_card");
  });

  it("does not flag random digits that fail Luhn", () => {
    expect(scan("ID: 1234567890123456")).not.toContain("credit_card");
  });

  it("detects SSN", () => {
    expect(scan("SSN: 123-45-6789")).toContain("ssn");
  });

  it("detects API keys", () => {
    // Split so secret scanners don't flag the fixtures themselves.
    const openai = `${"sk-"}${"proj-abc123XYZdef456GHIjkl789MNOpqr"}`;
    expect(scan(`OPENAI_API_KEY=${openai}`)).toContain("api_key");
    const stripe = `${"sk_live_"}${"51HabCdefghijklmnopqrstuvwxyz"}`;
    expect(scan(`STRIPE=${stripe}`)).toContain("api_key");
  });

  it("detects bearer tokens in header position", () => {
    expect(
      scan("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload"),
    ).toContain("bearer_token");
  });

  it("returns nothing for clean prose", () => {
    expect(scan("the quick brown fox jumps over the lazy dog")).toEqual([]);
  });

  it("only scans up to the char cap (bounds hot-path cost)", () => {
    // Secret sits past the cap, so it must not be detected.
    const padding = " ".repeat(100);
    const secret = "SSN: 123-45-6789 ";
    expect(scan(padding + secret, 50)).not.toContain("ssn");
    // Within the cap it is found.
    expect(scan(secret + padding, 50)).toContain("ssn");
  });

  it("flags multiple categories in a realistic prompt", () => {
    const prompt =
      "Resumen: paciente Juan Perez, jperez@gmail.com, +54 9 11 5555-1234, " +
      "antecedentes de hipertension. Ultimo check-in 14/04/2026.";
    const hits = scan(prompt);
    expect(hits).toContain("email");
    expect(hits).toContain("phone");
  });
});

describe("Detectors (config-driven)", () => {
  it("matches a custom pattern and uses the operator's label", () => {
    const d = new Detectors({
      defaultAction: "log",
      custom: [{ name: "customer_id", regex: /CUST-[A-Z0-9]{8}/ }],
    });
    const hits = d.scan("processing CUST-AB12CD34 now");
    expect(hits.map((h) => h.label)).toContain("customer_id");
  });

  it("per-pattern action overrides the default", () => {
    const d = new Detectors({
      defaultAction: "log",
      custom: [
        { name: "tame", regex: /tame/, action: "log" },
        { name: "dangerous", regex: /dangerous/, action: "block" },
      ],
    });
    const hits = d.scan("tame and dangerous");
    expect(hits.find((h) => h.label === "tame")?.action).toBe("log");
    expect(hits.find((h) => h.label === "dangerous")?.action).toBe("block");
  });

  it("only runs the built-ins it was given", () => {
    const d = new Detectors({ defaultAction: "log", builtins: ["ssn"] });
    const hits = d.scan("call me at +1 555 123 4567 — SSN 123-45-6789");
    const labels = hits.map((h) => h.label);
    expect(labels).toContain("ssn");
    expect(labels).not.toContain("phone");
  });

  it("disables every built-in when given an empty list", () => {
    const d = new Detectors({ defaultAction: "log", builtins: [] });
    expect(d.scan("SSN: 123-45-6789")).toEqual([]);
  });

  it("respects the per-instance maxChars cap", () => {
    const d = new Detectors({ defaultAction: "log", maxChars: 10 });
    expect(d.scan("xxxxxxxxxxxxxxxxxxxxSSN: 123-45-6789").map((h) => h.label)).not.toContain(
      "ssn",
    );
  });
});
