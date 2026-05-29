import { describe, it, expect } from "vitest";
import "../experience-parser.js";

const { parseExperienceSection, pickPrimary, _internals } =
  globalThis.NatvigatorExperience;

/** Build a realistic full-page innerText with a preamble and a trailing section. */
function page(experienceBlock, { preamble = "Jane Doe\nMarketing leader\n500+ connections\n", trailer = "\nEducation\nStanford University\nMBA\n2012 - 2014\n" } = {}) {
  return preamble + "Experience\n" + experienceBlock + trailer;
}

/** Simulate LinkedIn's innerText line-doubling (aria-hidden + visually-hidden spans). */
function withDuplicates(text) {
  return text
    .split("\n")
    .flatMap((l) => (l.trim() ? [l, l] : [l]))
    .join("\n");
}

describe("parseExperienceSection — multiple current companies (the Busy Bees case)", () => {
  const busyBees = [
    "Manager, Performance Marketing",
    "Busy Bees Asia · Full-time",
    "Dec 2025 - Present · 6 mos",
    "Divemaster",
    "PADI · Freelance",
    "Oct 2019 - Present · 6 yrs 8 mos",
    "Singapore · Remote",
    "•Email: zeph.underwater@gmail.com",
    "• Sidemount | Nitrox | Equipment Specialist",
    "Community Management",
  ].join("\n");

  it("selects the TOPMOST current role when several are still Present", () => {
    const { entries, primary } = parseExperienceSection(page(busyBees));

    expect(entries.slice(0, 2)).toEqual([
      { title: "Manager, Performance Marketing", company: "Busy Bees Asia", isCurrent: true },
      { title: "Divemaster", company: "PADI", isCurrent: true },
    ]);
    expect(primary).toEqual({
      title: "Manager, Performance Marketing",
      company: "Busy Bees Asia",
      isCurrent: true,
    });
  });

  it("survives LinkedIn's innerText line duplication", () => {
    const { primary } = parseExperienceSection(page(withDuplicates(busyBees)));
    expect(primary?.company).toBe("Busy Bees Asia");
    expect(primary?.title).toBe("Manager, Performance Marketing");
  });

  it("does not get confused by the secondary PADI gig", () => {
    const { primary } = parseExperienceSection(page(busyBees));
    expect(primary?.company).not.toBe("PADI");
    expect(primary?.title).not.toBe("Divemaster");
  });
});

describe("parseExperienceSection — layouts", () => {
  it("handles a single current inline role", () => {
    const block = ["Software Engineer", "Stripe · Full-time", "Jan 2022 - Present · 3 yrs"].join("\n");
    const { primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Software Engineer", company: "Stripe", isCurrent: true });
  });

  it("handles the grouped layout (one company, several roles)", () => {
    const block = [
      "Evo Commerce",
      "2 yrs 11 mos",
      "Head of Marketing",
      "Jan 2023 - Present · 1 yr",
      "Greater Singapore",
      "Marketing Manager",
      "Jan 2022 - Jan 2023 · 1 yr 1 mo",
    ].join("\n");
    const { entries, primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Head of Marketing", company: "Evo Commerce", isCurrent: true });
    expect(entries).toEqual([
      { title: "Head of Marketing", company: "Evo Commerce", isCurrent: true },
      { title: "Marketing Manager", company: "Evo Commerce", isCurrent: false },
    ]);
  });

  it("detects a grouped company when tenure is in reversed 'duration · type' format", () => {
    const block = [
      "Lendela",
      "5 yrs · Full-time",
      "Chief Operating Officer",
      "Mar 2020 - Present · 5 yrs",
    ].join("\n");
    const { primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Chief Operating Officer", company: "Lendela", isCurrent: true });
  });

  it("handles an inline role with the employment type omitted", () => {
    const block = ["Head of Growth", "Acme", "Jan 2022 - Present · 3 yrs"].join("\n");
    const { primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Head of Growth", company: "Acme", isCurrent: true });
  });

  it("corrects an obvious title↔company swap", () => {
    const block = ["Acme Holdings", "Senior Manager · Full-time", "Jan 2022 - Present · 1 yr"].join("\n");
    const { primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Senior Manager", company: "Acme Holdings", isCurrent: true });
  });
});

describe("parseExperienceSection — selection fallbacks", () => {
  it("falls back to the topmost role when none are current", () => {
    const block = [
      "Product Designer",
      "Acme Inc · Full-time",
      "Jan 2018 - Dec 2020 · 3 yrs",
      "UX Designer",
      "Beta LLC · Full-time",
      "Jan 2015 - Dec 2017 · 3 yrs",
    ].join("\n");
    const { primary } = parseExperienceSection(page(block));
    expect(primary).toEqual({ title: "Product Designer", company: "Acme Inc", isCurrent: false });
  });

  it("prefers a current role with a company over a current role without one", () => {
    const entries = [
      { title: "Advisor", company: "", isCurrent: true },
      { title: "CEO", company: "Acme", isCurrent: true },
    ];
    expect(pickPrimary(entries)).toEqual({ title: "CEO", company: "Acme", isCurrent: true });
  });

  it("returns null when there is no Experience section", () => {
    const { entries, primary } = parseExperienceSection("Jane Doe\nSome headline\nAbout\nLorem ipsum\n");
    expect(entries).toEqual([]);
    expect(primary).toBeNull();
  });
});

describe("parseExperienceSection — robustness", () => {
  it("does not treat description text containing a year as a date line", () => {
    const block = [
      "Marketing Lead",
      "Acme Co · Full-time",
      "Jan 2021 - Present · 4 yrs",
      "• Grew revenue 200% since 2019 launch",
      "Managed the 2020 rebrand across 12 markets",
    ].join("\n");
    const { entries, primary } = parseExperienceSection(page(block));
    expect(entries).toHaveLength(1);
    expect(primary?.company).toBe("Acme Co");
  });

  it("stops at the next profile section (does not parse Education entries)", () => {
    const block = ["Software Engineer", "Stripe · Full-time", "Jan 2022 - Present · 3 yrs"].join("\n");
    const full = page(block, { trailer: "\nEducation\nMIT\nBSc Computer Science\n2014 - 2018\nSkills\nReact\n" });
    const { entries } = parseExperienceSection(full);
    expect(entries).toHaveLength(1);
    expect(entries[0].company).toBe("Stripe");
  });
});

describe("_internals classifiers", () => {
  it("isDateRangeLine recognises real date ranges only", () => {
    expect(_internals.isDateRangeLine("Dec 2025 - Present · 6 mos")).toBe(true);
    expect(_internals.isDateRangeLine("Jan 2022 - Jan 2023 · 1 yr")).toBe(true);
    expect(_internals.isDateRangeLine("2019 - 2021")).toBe(true);
    expect(_internals.isDateRangeLine("2 yrs 11 mos")).toBe(false);
    expect(_internals.isDateRangeLine("• Led the 2020 campaign")).toBe(false);
    expect(_internals.isDateRangeLine("Manager, Performance Marketing")).toBe(false);
  });

  it("isGroupedTenureLine recognises grouped total-tenure lines", () => {
    expect(_internals.isGroupedTenureLine("2 yrs 11 mos")).toBe(true);
    expect(_internals.isGroupedTenureLine("5 yrs")).toBe(true);
    expect(_internals.isGroupedTenureLine("Full-time · 5 yrs 9 mos")).toBe(true);
    expect(_internals.isGroupedTenureLine("5 yrs · Full-time")).toBe(true);
    expect(_internals.isGroupedTenureLine("Dec 2025 - Present · 6 mos")).toBe(false);
    expect(_internals.isGroupedTenureLine("Busy Bees Asia · Full-time")).toBe(false);
  });

  it("dedupeAdjacent collapses consecutive duplicate lines", () => {
    expect(_internals.dedupeAdjacent(["A", "A", "B", "B", "A"])).toEqual(["A", "B", "A"]);
  });
});
