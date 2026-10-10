import { describe, expect, it } from "vitest";
import { CITIES, findCity, parseRegion } from "@/lib/tour/cities";
import { haversineKm, nearestNeighbour, pathKm, routeOrder, showDates, twoOpt } from "@/lib/tour/route";

const pt = (name: string) => {
  const c = findCity(name)!;
  return { lat: c.lat, lon: c.lon };
};

describe("geometry", () => {
  it("haversine matches known distances", () => {
    expect(haversineKm(pt("New York"), pt("Los Angeles"))).toBeCloseTo(3936, -2);
    expect(haversineKm(pt("London"), pt("Paris"))).toBeCloseTo(344, -1);
    expect(haversineKm(pt("Austin"), pt("Austin"))).toBe(0);
  });
});

describe("routing", () => {
  const names = ["New York", "Los Angeles", "Chicago", "Seattle", "Miami", "Denver", "Boston", "Phoenix"];
  const points = names.map(pt);

  it("nearest neighbour visits every point once", () => {
    const o = nearestNeighbour(points, 0);
    expect([...o].sort((a, b) => a - b)).toEqual(points.map((_, i) => i));
    expect(o[0]).toBe(0);
    expect(names[o[1]]).toBe("Boston");
  });

  it("2-opt never makes the path longer and keeps the start fixed", () => {
    const nn = nearestNeighbour(points, 0);
    const opt = twoOpt(points, nn);
    expect(pathKm(opt.map((i) => points[i]))).toBeLessThanOrEqual(pathKm(nn.map((i) => points[i])) + 1e-6);
    expect(opt[0]).toBe(0);
    const bad = [0, 1, 2, 3, 4, 5, 6, 7]; // NY -> LA -> Chicago -> Seattle... zig-zag
    const fixed = twoOpt(points, bad);
    expect(pathKm(fixed.map((i) => points[i]))).toBeLessThan(pathKm(bad.map((i) => points[i])) * 0.7);
  });

  it("routeOrder picks the best start when none is given and honours a given one", () => {
    const free = routeOrder(points);
    const fromMiami = routeOrder(points, names.indexOf("Miami"));
    expect(names[fromMiami[0]]).toBe("Miami");
    expect(pathKm(free.map((i) => points[i]))).toBeLessThanOrEqual(pathKm(fromMiami.map((i) => points[i])) + 1e-6);
    expect(routeOrder([])).toEqual([]);
    expect(routeOrder([points[0]])).toEqual([0]);
  });

  it("spreads show dates", () => {
    expect(showDates(new Date("2027-03-01T00:00:00Z"), 3, 2)).toEqual(["2027-03-01", "2027-03-03", "2027-03-05"]);
    expect(showDates(new Date("2027-03-30T00:00:00Z"), 2, 3)).toEqual(["2027-03-30", "2027-04-02"]);
  });
});

describe("city catalogue", () => {
  it("has unique names with coordinates in range", () => {
    const names = new Set(CITIES.map((c) => c.name));
    expect(names.size).toBe(CITIES.length);
    for (const c of CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
  });
  it("finds cities loosely and parses regions", () => {
    expect(findCity("austin")?.name).toBe("Austin");
    expect(findCity("St Louis")?.name).toBe("St. Louis");
    expect(findCity("Atlantis")).toBeUndefined();
    expect(parseRegion("a 12-city North American tour")).toBe("North America");
    expect(parseRegion("tour the UK")).toBe("UK & Ireland");
    expect(parseRegion("European dates")).toBe("Europe");
    expect(parseRegion("anywhere")).toBeUndefined();
  });
});
