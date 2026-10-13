import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, itineraryToCsv, itineraryToJson, itineraryToMarkdown } from "@/lib/tour/export";
import type { Itinerary } from "@/lib/tour/types";

const it1: Itinerary = {
  id: "tour_x",
  act: { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes" },
  stops: [
    { order: 1, city: "Austin", country: "US", lat: 30.27, lon: -97.74, date: "2027-03-01", score: 0.812, venue: { entity_id: "v1", name: 'The "Foundry" Hall, Austin', affinity: 0.8, capacity: 2200, estimatedCostUsd: 9800 }, opener: { entity_id: "o1", name: "Juno Vale", affinity: 0.7 }, brand: { entity_id: "b1", name: "Northline Coffee", affinity: 0.6 }, legKm: 0 },
    { order: 2, city: "Dallas", country: "US", lat: 32.78, lon: -96.8, date: "2027-03-03", score: 0.75, legKm: 293 },
  ],
  totalKm: 293,
  startDate: "2027-03-01",
  endDate: "2027-03-03",
  estimatedCostUsd: 9800,
  builtAt: "2026-10-10T00:00:00.000Z",
  mode: "fixture",
};

describe("exports", () => {
  it("writes CSV with a header, quoting as needed", () => {
    const csv = itineraryToCsv(it1);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1]).toBe('1,2027-03-01,Austin,US,0.812,"The ""Foundry"" Hall, Austin",2200,9800,Juno Vale,Northline Coffee,0,30.27,-97.74');
    expect(lines[2]).toBe("2,2027-03-03,Dallas,US,0.75,,,,,,293,32.78,-96.8");
  });
  it("writes a Markdown table that names the data source", () => {
    const md = itineraryToMarkdown(it1);
    expect(md).toContain("# Nova Reyes - 2-stop tour (2027-03-01 to 2027-03-03)");
    expect(md).toContain("estimated venue cost $9,800");
    expect(itineraryToMarkdown({ ...it1, estimatedCostUsd: 0 })).not.toContain("venue cost");
    expect(md).toContain("synthetic fixtures");
    expect(md).toContain("| 1 | 2027-03-01 | Austin, US | 81% |");
    expect(md).toContain("| 2 | 2027-03-03 | Dallas, US | 75% | - | - | - | 293 km |");
  });
  it("round-trips JSON", () => {
    expect(JSON.parse(itineraryToJson(it1))).toEqual(it1);
  });
});
