/**
 * Dependency Extractor — parses TypeScript source to find imports and side channels.
 */

export interface ExtractedDep {
  kind: 'import';
  source: string;       // the import specifier (package name or path)
  is_relative: boolean;
  source_line: number;
}

export interface ExtractedSideChannel {
  kind: 'database' | 'queue' | 'cache' | 'config' | 'external_api' | 'file';
  identifier: string;   // the detected identifier (env var name, URL, etc.)
  source_line: number;
}

export interface DependencyGraph {
  file_path: string;
  imports: ExtractedDep[];
  side_channels: ExtractedSideChannel[];
}

/**
 * Extract dependencies from TypeScript source code.
 * Uses regex-based parsing (no AST in v1).
 */
export function extractDependencies(source: string, filePath: string): DependencyGraph {
  const lines = source.split('\n');
  const imports: ExtractedDep[] = [];
  const sideChannels: ExtractedSideChannel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // Strip line + single-line block comments so commented-out imports/side-channels are
    // not extracted. The `(?<!:)` guard protects a URL scheme's `//` (http://…).
    const line = lines[i].replace(/(?<!:)\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

    // Static import/export ... from / bare import — only at STATEMENT position (start of
    // line or after ';') so a string literal containing "import" is not matched, while
    // multiple statements on one line are all captured.
    for (const m of line.matchAll(/(?:^|;)\s*(?:import|export)\s+(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]/g)) {
      addImport(imports, m[1], lineNum);
    }
    // Dynamic import('x') and require('x') — function-call form, may appear inline.
    for (const m of line.matchAll(/(?<![\w$.])(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) {
      addImport(imports, m[1], lineNum);
    }

    // ── Side channels (comment-stripped, global so every occurrence is captured) ──
    for (const m of line.matchAll(/process\.env\.(\w+)/g)) {
      sideChannels.push({ kind: 'config', identifier: m[1], source_line: lineNum });
    }
    for (const m of line.matchAll(/process\.env\[['"]([^'"]+)['"]\]/g)) {
      sideChannels.push({ kind: 'config', identifier: m[1], source_line: lineNum });
    }
    for (const m of line.matchAll(/(?<![\w$.])(?:fetch|new\s+URL)\s*\(\s*['"]([^'"]+)['"]/g)) {
      sideChannels.push({ kind: 'external_api', identifier: m[1], source_line: lineNum });
    }
    for (const _m of line.matchAll(/(?:createConnection|createPool|new\s+Pool|new\s+PrismaClient|mongoose\.connect)\s*\(/g)) {
      sideChannels.push({ kind: 'database', identifier: 'database_connection', source_line: lineNum });
    }
    for (const m of line.matchAll(/(?<![\w$])fs\.(readFile|writeFile|readdir|mkdir|unlink|stat|access)/g)) {
      sideChannels.push({ kind: 'file', identifier: `fs.${m[1]}`, source_line: lineNum });
    }
    for (const _m of line.matchAll(/(?:new\s+Redis|createClient|redis\.connect)/g)) {
      sideChannels.push({ kind: 'cache', identifier: 'redis_connection', source_line: lineNum });
    }
  }

  return { file_path: filePath, imports, side_channels: sideChannels };
}

function addImport(imports: ExtractedDep[], source: string, line: number): void {
  imports.push({ kind: 'import', source, is_relative: source.startsWith('.') || source.startsWith('/'), source_line: line });
}
