/**
 * Returns the user's plant memberships, or null when the attribute is missing or
 * malformed (non-array, empty, blank, too long, wildcard). Same rule as M03's
 * AssemblyCatalog handler; null must be treated as "no access".
 */
export function userPlants(user) {
  const plants = user?.attr?.plants;
  if (!Array.isArray(plants) || !plants.length) return null;
  if (plants.some(p => typeof p !== 'string' || !p.trim() || p.length > 4 || p.includes('*'))) return null;
  return plants;
}
