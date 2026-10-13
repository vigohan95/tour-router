/**
 * Candidate markets. Public, well-known coordinates (rounded to 2 decimals); this is the routing map, not Qloo data.
 * Qloo supplies the affinity of each market's population with the act; this file only says where the markets are.
 */
export type Region = "North America" | "Europe" | "UK & Ireland" | "Oceania" | "Latin America";

export interface City {
  name: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
  /** Rough metro population in millions (public figures, rounded). Used only as a tie-breaker and for venue sizing. */
  metroM: number;
  /** Disambiguated name for Qloo's locality resolver (signal.location.query / filter.location.query); defaults to `name`. */
  query?: string;
}

/**
 * Qloo locality query for each country code in the catalogue (verified 2026-10-13: every one resolves to a
 * urn:entity:locality of that name, e.g. "Czech Republic" -> "Czechia"). One heatmap per country per act ranks
 * every candidate city in it on the same scale.
 */
export const COUNTRY_QUERY: Record<string, string> = { US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain", IT: "Italy", SE: "Sweden", BE: "Belgium", PT: "Portugal", PL: "Poland", AT: "Austria", CZ: "Czech Republic", DK: "Denmark", NO: "Norway", CH: "Switzerland", FI: "Finland", AU: "Australia", NZ: "New Zealand", BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia", PE: "Peru" };

export const CITIES: City[] = [
  // North America
  { name: "New York", country: "US", region: "North America", lat: 40.71, lon: -74.01, metroM: 19.5 },
  { name: "Los Angeles", country: "US", region: "North America", lat: 34.05, lon: -118.24, metroM: 12.9 },
  { name: "Chicago", country: "US", region: "North America", lat: 41.88, lon: -87.63, metroM: 9.3 },
  { name: "Toronto", query: "Toronto, Ontario", country: "CA", region: "North America", lat: 43.65, lon: -79.38, metroM: 6.7 },
  { name: "Mexico City", country: "MX", region: "North America", lat: 19.43, lon: -99.13, metroM: 21.8 },
  { name: "Dallas", country: "US", region: "North America", lat: 32.78, lon: -96.8, metroM: 7.9 },
  { name: "Houston", country: "US", region: "North America", lat: 29.76, lon: -95.37, metroM: 7.3 },
  { name: "Atlanta", country: "US", region: "North America", lat: 33.75, lon: -84.39, metroM: 6.2 },
  { name: "Miami", country: "US", region: "North America", lat: 25.76, lon: -80.19, metroM: 6.1 },
  { name: "Philadelphia", country: "US", region: "North America", lat: 39.95, lon: -75.17, metroM: 6.2 },
  { name: "Washington", query: "Washington, D.C.", country: "US", region: "North America", lat: 38.91, lon: -77.04, metroM: 6.3 },
  { name: "Boston", country: "US", region: "North America", lat: 42.36, lon: -71.06, metroM: 4.9 },
  { name: "San Francisco", country: "US", region: "North America", lat: 37.77, lon: -122.42, metroM: 4.6 },
  { name: "Seattle", country: "US", region: "North America", lat: 47.61, lon: -122.33, metroM: 4.0 },
  { name: "Denver", country: "US", region: "North America", lat: 39.74, lon: -104.99, metroM: 3.0 },
  { name: "Phoenix", query: "Phoenix, Arizona", country: "US", region: "North America", lat: 33.45, lon: -112.07, metroM: 5.0 },
  { name: "Austin", country: "US", region: "North America", lat: 30.27, lon: -97.74, metroM: 2.4 },
  { name: "Nashville", query: "Nashville, Tennessee", country: "US", region: "North America", lat: 36.16, lon: -86.78, metroM: 2.0 },
  { name: "Minneapolis", country: "US", region: "North America", lat: 44.98, lon: -93.27, metroM: 3.7 },
  { name: "Detroit", country: "US", region: "North America", lat: 42.33, lon: -83.05, metroM: 4.3 },
  { name: "Portland", query: "Portland, Oregon", country: "US", region: "North America", lat: 45.52, lon: -122.68, metroM: 2.5 },
  { name: "Las Vegas", country: "US", region: "North America", lat: 36.17, lon: -115.14, metroM: 2.3 },
  { name: "San Diego", country: "US", region: "North America", lat: 32.72, lon: -117.16, metroM: 3.3 },
  { name: "New Orleans", country: "US", region: "North America", lat: 29.95, lon: -90.07, metroM: 1.3 },
  { name: "Salt Lake City", country: "US", region: "North America", lat: 40.76, lon: -111.89, metroM: 1.3 },
  { name: "Kansas City", query: "Kansas City, Missouri", country: "US", region: "North America", lat: 39.1, lon: -94.58, metroM: 2.2 },
  { name: "St. Louis", query: "St. Louis, Missouri", country: "US", region: "North America", lat: 38.63, lon: -90.2, metroM: 2.8 },
  { name: "Charlotte", query: "Charlotte, North Carolina", country: "US", region: "North America", lat: 35.23, lon: -80.84, metroM: 2.7 },
  { name: "Pittsburgh", country: "US", region: "North America", lat: 40.44, lon: -79.99, metroM: 2.4 },
  { name: "Cleveland", query: "Cleveland, Ohio", country: "US", region: "North America", lat: 41.5, lon: -81.69, metroM: 2.1 },
  { name: "Columbus", query: "Columbus, Ohio", country: "US", region: "North America", lat: 39.96, lon: -83.0, metroM: 2.1 },
  { name: "Indianapolis", country: "US", region: "North America", lat: 39.77, lon: -86.16, metroM: 2.1 },
  { name: "Tampa", query: "Tampa, Florida", country: "US", region: "North America", lat: 27.95, lon: -82.46, metroM: 3.2 },
  { name: "Orlando", query: "Orlando, Florida", country: "US", region: "North America", lat: 28.54, lon: -81.38, metroM: 2.7 },
  { name: "Raleigh", query: "Raleigh, North Carolina", country: "US", region: "North America", lat: 35.78, lon: -78.64, metroM: 1.4 },
  { name: "Sacramento", query: "Sacramento, California", country: "US", region: "North America", lat: 38.58, lon: -121.49, metroM: 2.4 },
  { name: "Vancouver", query: "Vancouver, British Columbia", country: "CA", region: "North America", lat: 49.28, lon: -123.12, metroM: 2.6 },
  { name: "Montreal", query: "Montréal", country: "CA", region: "North America", lat: 45.5, lon: -73.57, metroM: 4.3 },
  { name: "Calgary", query: "Calgary, Alberta", country: "CA", region: "North America", lat: 51.05, lon: -114.07, metroM: 1.5 },
  { name: "Guadalajara", query: "Guadalajara, Mexico", country: "MX", region: "North America", lat: 20.67, lon: -103.35, metroM: 5.3 },
  { name: "Monterrey", query: "Monterrey, Mexico", country: "MX", region: "North America", lat: 25.69, lon: -100.32, metroM: 5.3 },
  // Europe
  { name: "Berlin", query: "Berlin, Germany", country: "DE", region: "Europe", lat: 52.52, lon: 13.41, metroM: 6.1 },
  { name: "Paris", query: "Paris, France", country: "FR", region: "Europe", lat: 48.86, lon: 2.35, metroM: 12.3 },
  { name: "Amsterdam", query: "Amsterdam, Netherlands", country: "NL", region: "Europe", lat: 52.37, lon: 4.9, metroM: 2.5 },
  { name: "Madrid", query: "Madrid, Spain", country: "ES", region: "Europe", lat: 40.42, lon: -3.7, metroM: 6.8 },
  { name: "Barcelona", query: "Barcelona, Spain", country: "ES", region: "Europe", lat: 41.39, lon: 2.17, metroM: 5.6 },
  { name: "Milan", query: "Milan, Italy", country: "IT", region: "Europe", lat: 45.46, lon: 9.19, metroM: 4.3 },
  { name: "Lisbon", query: "Lisbon, Portugal", country: "PT", region: "Europe", lat: 38.72, lon: -9.14, metroM: 2.9 },
  { name: "Copenhagen", query: "Copenhagen, Denmark", country: "DK", region: "Europe", lat: 55.68, lon: 12.57, metroM: 2.1 },
  { name: "Stockholm", query: "Stockholm, Sweden", country: "SE", region: "Europe", lat: 59.33, lon: 18.07, metroM: 2.4 },
  { name: "Vienna", query: "Vienna, Austria", country: "AT", region: "Europe", lat: 48.21, lon: 16.37, metroM: 2.9 },
  { name: "Prague", query: "Prague, Czechia", country: "CZ", region: "Europe", lat: 50.08, lon: 14.44, metroM: 2.7 },
  { name: "Warsaw", query: "Warsaw, Poland", country: "PL", region: "Europe", lat: 52.23, lon: 21.01, metroM: 3.1 },
  { name: "Brussels", query: "Brussels, Belgium", country: "BE", region: "Europe", lat: 50.85, lon: 4.35, metroM: 2.1 },
  { name: "Munich", query: "Munich, Germany", country: "DE", region: "Europe", lat: 48.14, lon: 11.58, metroM: 2.9 },
  { name: "Hamburg", query: "Hamburg, Germany", country: "DE", region: "Europe", lat: 53.55, lon: 9.99, metroM: 3.2 },
  { name: "Cologne", query: "Cologne, Germany", country: "DE", region: "Europe", lat: 50.94, lon: 6.96, metroM: 3.6 },
  { name: "Zurich", query: "Zürich", country: "CH", region: "Europe", lat: 47.37, lon: 8.54, metroM: 1.5 },
  { name: "Oslo", query: "Oslo, Norway", country: "NO", region: "Europe", lat: 59.91, lon: 10.75, metroM: 1.6 },
  { name: "Helsinki", query: "Helsinki, Finland", country: "FI", region: "Europe", lat: 60.17, lon: 24.94, metroM: 1.5 },
  // UK & Ireland
  { name: "London", query: "London, England", country: "GB", region: "UK & Ireland", lat: 51.51, lon: -0.13, metroM: 14.3 },
  { name: "Manchester", query: "Manchester, England", country: "GB", region: "UK & Ireland", lat: 53.48, lon: -2.24, metroM: 2.9 },
  { name: "Glasgow", query: "Glasgow, Scotland", country: "GB", region: "UK & Ireland", lat: 55.86, lon: -4.25, metroM: 1.8 },
  { name: "Birmingham", query: "Birmingham, England", country: "GB", region: "UK & Ireland", lat: 52.49, lon: -1.89, metroM: 2.9 },
  { name: "Dublin", query: "Dublin, Ireland", country: "IE", region: "UK & Ireland", lat: 53.35, lon: -6.26, metroM: 2.1 },
  { name: "Leeds", query: "Leeds, England", country: "GB", region: "UK & Ireland", lat: 53.8, lon: -1.55, metroM: 2.3 },
  { name: "Bristol", query: "Bristol, England", country: "GB", region: "UK & Ireland", lat: 51.45, lon: -2.59, metroM: 1.2 },
  // Oceania
  { name: "Sydney", query: "Sydney, Australia", country: "AU", region: "Oceania", lat: -33.87, lon: 151.21, metroM: 5.3 },
  { name: "Melbourne", query: "Melbourne, Australia", country: "AU", region: "Oceania", lat: -37.81, lon: 144.96, metroM: 5.1 },
  { name: "Brisbane", query: "Brisbane, Australia", country: "AU", region: "Oceania", lat: -27.47, lon: 153.03, metroM: 2.6 },
  { name: "Auckland", query: "Auckland, New Zealand", country: "NZ", region: "Oceania", lat: -36.85, lon: 174.76, metroM: 1.7 },
  // Latin America
  { name: "Sao Paulo", query: "São Paulo", country: "BR", region: "Latin America", lat: -23.55, lon: -46.63, metroM: 22.6 },
  { name: "Buenos Aires", query: "Buenos Aires, Argentina", country: "AR", region: "Latin America", lat: -34.6, lon: -58.38, metroM: 15.6 },
  { name: "Bogota", query: "Bogotá", country: "CO", region: "Latin America", lat: 4.71, lon: -74.07, metroM: 11.3 },
  { name: "Santiago", query: "Santiago, Chile", country: "CL", region: "Latin America", lat: -33.45, lon: -70.67, metroM: 7.1 },
  { name: "Lima", query: "Lima, Peru", country: "PE", region: "Latin America", lat: -12.05, lon: -77.04, metroM: 11.0 },
];

export const REGIONS: Region[] = ["North America", "Europe", "UK & Ireland", "Oceania", "Latin America"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function findCity(name: string): City | undefined {
  const n = norm(name);
  return CITIES.find((c) => norm(c.name) === n) ?? CITIES.find((c) => norm(c.name).startsWith(n) && n.length >= 4);
}

/** The name sent to Qloo's locality resolver. */
export const qlooLocality = (c: City) => c.query ?? c.name;

export function citiesIn(regions: Region[] | undefined): City[] {
  if (!regions || regions.length === 0) return CITIES;
  return CITIES.filter((c) => regions.includes(c.region));
}

export function parseRegion(text: string): Region | undefined {
  const t = text.toLowerCase();
  if (/\b(north americas?|north american|na tour|us tour|usa|united states|america|american|canada|mexico)\b/.test(t)) return "North America";
  if (/\b(uk|united kingdom|britain|british|ireland|irish)\b/.test(t)) return "UK & Ireland";
  if (/\b(europe|european|eu tour)\b/.test(t)) return "Europe";
  if (/\b(oceania|australia|australian|new zealand|anz)\b/.test(t)) return "Oceania";
  if (/\b(latin america|latam|south america|brazil|argentina)\b/.test(t)) return "Latin America";
  return undefined;
}
