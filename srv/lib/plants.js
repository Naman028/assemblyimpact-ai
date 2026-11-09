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

/**
 * P1: plants of the JouleReader technical client. Only for a client-credentials identity
 * (system-user) that holds JouleReader and NO business role; plants come from server
 * configuration (cds.requires.joule.plants), never from the request or the token. Returns
 * null when the identity or the configuration is not acceptable ("no access").
 */
export const BUSINESS_ROLES = Object.freeze(['ChangeViewer', 'ChangeAnalyst', 'ChangeApprover', 'AssemblyMaintainer', 'AssemblyViewer', 'DemoDataManager']);
export function jouleReaderPlants(user, configured) {
  if (!user?.is?.('JouleReader') || !user.is('system-user')) return null;
  if (BUSINESS_ROLES.some(r => user.is(r))) return null;
  return userPlants({ attr: { plants: configured } });
}
