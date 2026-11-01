import { NO_TERRAIN, type TerrainProvider } from './terrain';

/*
 * Browser terrain service: loads the 1-degree PNG tiles described in
 * terrain.ts and answers elevation queries. Implemented with the terrain
 * pipeline; until then it reports no data.
 */
export function createTerrainService(_baseUrl: string): TerrainProvider {
  return NO_TERRAIN;
}
