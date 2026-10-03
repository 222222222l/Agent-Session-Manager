// Local compatibility shim. Upstream discovery modules are otherwise unchanged.
// Derived from CCHistory PlatformAdapter; see LICENSE and upstreams.lock.json.
export interface PlatformAdapter {
  platform: string;
  supportTier: 'stable' | 'experimental';
  getDefaultBaseDirCandidates(options: { homeDir?: string }): string[];
  matchesSourceFile(filePath: string): boolean;
  logicalSessionGrouping?: 'source_session_id';
  getSourceRoots?(baseDir: string): string[];
  getCompanionEvidencePaths?(baseDir: string, filePath: string): string[];
}
