import { describe, it, expect } from "vitest";
import { rowToProfile } from "../access";

describe("rowToProfile", () => {
  it("maps snake_case DB columns to camelCase CloProfile fields", () => {
    const row = {
      id: "profile-1",
      user_id: "user-abc",
      fund_strategy: "senior secured",
      target_sectors: "healthcare, tech",
      risk_appetite: "conservative",
      portfolio_size: "500m",
      reinvestment_period: "2 years",
      concentration_limits: "10% per obligor",
      covenant_preferences: "cov-lite acceptable",
      rating_thresholds: "B- minimum",
      spread_targets: "E+450",
      regulatory_constraints: "none",
      portfolio_description: "broadly syndicated loans",
      beliefs_and_biases: "prefer US",
      raw_questionnaire: { q1: "yes" },
      documents: [{ name: "doc.pdf", type: "application/pdf", size: 1024, base64: "abc" }],
      extracted_constraints: { capitalStructure: [] },
      extracted_portfolio: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-06-01T00:00:00Z",
    };

    const profile = rowToProfile(row);

    expect(profile.id).toBe("profile-1");
    expect(profile.userId).toBe("user-abc");
    expect(profile.fundStrategy).toBe("senior secured");
    expect(profile.targetSectors).toBe("healthcare, tech");
    expect(profile.riskAppetite).toBe("conservative");
    expect(profile.portfolioSize).toBe("500m");
    expect(profile.reinvestmentPeriod).toBe("2 years");
    expect(profile.concentrationLimits).toBe("10% per obligor");
    expect(profile.covenantPreferences).toBe("cov-lite acceptable");
    expect(profile.ratingThresholds).toBe("B- minimum");
    expect(profile.spreadTargets).toBe("E+450");
    expect(profile.regulatoryConstraints).toBe("none");
    expect(profile.portfolioDescription).toBe("broadly syndicated loans");
    expect(profile.beliefsAndBiases).toBe("prefer US");
    expect(profile.rawQuestionnaire).toEqual({ q1: "yes" });
    expect(profile.documents).toHaveLength(1);
    expect(profile.extractedConstraints).toEqual({ capitalStructure: [] });
    expect(profile.extractedPortfolio).toBeNull();
    expect(profile.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(profile.updatedAt).toBe("2024-06-01T00:00:00Z");
  });

  it("falls back to empty strings for missing string fields", () => {
    const row = { id: "p2" };
    const profile = rowToProfile(row);

    expect(profile.userId).toBe("");
    expect(profile.fundStrategy).toBe("");
    expect(profile.targetSectors).toBe("");
    expect(profile.portfolioSize).toBe("");
    expect(profile.reinvestmentPeriod).toBe("");
    expect(profile.concentrationLimits).toBe("");
    expect(profile.covenantPreferences).toBe("");
    expect(profile.ratingThresholds).toBe("");
    expect(profile.spreadTargets).toBe("");
    expect(profile.regulatoryConstraints).toBe("");
    expect(profile.portfolioDescription).toBe("");
    expect(profile.beliefsAndBiases).toBe("");
    expect(profile.createdAt).toBe("");
    expect(profile.updatedAt).toBe("");
  });

  it("falls back to empty object for missing rawQuestionnaire", () => {
    const row = { id: "p3" };
    const profile = rowToProfile(row);
    expect(profile.rawQuestionnaire).toEqual({});
  });

  it("falls back to empty array for missing documents", () => {
    const row = { id: "p4" };
    const profile = rowToProfile(row);
    expect(profile.documents).toEqual([]);
  });

  it("falls back to empty object for missing extractedConstraints", () => {
    const row = { id: "p5" };
    const profile = rowToProfile(row);
    expect(profile.extractedConstraints).toEqual({});
  });

  it("falls back to null for missing extractedPortfolio", () => {
    const row = { id: "p6" };
    const profile = rowToProfile(row);
    expect(profile.extractedPortfolio).toBeNull();
  });

  it("defaults riskAppetite to 'moderate' when missing", () => {
    const row = { id: "p7" };
    const profile = rowToProfile(row);
    expect(profile.riskAppetite).toBe("moderate");
  });

  it("passes through object fields (rawQuestionnaire, extractedConstraints) without JSON parsing", () => {
    // pg returns JSONB columns as already-parsed objects, not strings
    const constraints = { capitalStructure: [{ class: "A", spreadBps: 150 }] };
    const row = { id: "p8", extracted_constraints: constraints, raw_questionnaire: { key: "value" } };
    const profile = rowToProfile(row);
    expect(profile.extractedConstraints).toBe(constraints);
    expect(profile.rawQuestionnaire).toEqual({ key: "value" });
  });
});
