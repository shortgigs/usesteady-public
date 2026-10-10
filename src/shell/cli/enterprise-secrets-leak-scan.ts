import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type LeakPattern = {
  readonly id: string;
  readonly regex: string;
};

export type LeakPatternsConfig = {
  readonly patterns: readonly LeakPattern[];
  readonly skipDirNames: readonly string[];
  readonly allowlistPathPrefixes: readonly string[];
  readonly allowlistPathContains: readonly string[];
  readonly allowlistLineSubstrings: readonly string[];
};

export type LeakMatch = {
  readonly patternId: string;
  readonly root: string;
  readonly relativePath: string;
  readonly line: number;
  readonly excerpt: string;
};

export type LeakScanResult = {
  readonly roots: readonly string[];
  readonly storeDirs: readonly string[];
  readonly filesScanned: number;
  readonly matches: readonly LeakMatch[];
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function normalizeRel(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function pathAllowlisted(
  relPath: string,
  config: LeakPatternsConfig,
): boolean {
  for (const prefix of config.allowlistPathPrefixes) {
    if (relPath === prefix || relPath.startsWith(prefix)) {
      return true;
    }
  }
  for (const fragment of config.allowlistPathContains) {
    if (relPath.includes(fragment.replace(/\\/g, "/"))) {
      return true;
    }
  }
  return false;
}

function lineAllowlisted(
  line: string,
  config: LeakPatternsConfig,
): boolean {
  for (const sub of config.allowlistLineSubstrings) {
    if (line.includes(sub)) {
      return true;
    }
  }
  return false;
}

function walkFiles(root: string, config: LeakPatternsConfig): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (config.skipDirNames.includes(name)) {
          continue;
        }
        stack.push(full);
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

export function scanTreeForLeaks(
  root: string,
  config: LeakPatternsConfig,
): { filesScanned: number; matches: LeakMatch[] } {
  const compiled = config.patterns.map((p) => ({
    id: p.id,
    re: new RegExp(p.regex, "g"),
  }));
  const matches: LeakMatch[] = [];
  let filesScanned = 0;

  for (const filePath of walkFiles(root, config)) {
    const relPath = normalizeRel(root, filePath);
    if (pathAllowlisted(relPath, config)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) {
      continue;
    }
    filesScanned += 1;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (lineAllowlisted(line, config)) {
        continue;
      }
      for (const { id, re } of compiled) {
        re.lastIndex = 0;
        if (re.test(line)) {
          matches.push({
            patternId: id,
            root,
            relativePath: relPath,
            line: i + 1,
            excerpt: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  return { filesScanned, matches };
}

export function runLeakScan(options: {
  readonly repoRoots: readonly string[];
  readonly storeDirs: readonly string[];
  readonly config: LeakPatternsConfig;
}): LeakScanResult {
  const allMatches: LeakMatch[] = [];
  let filesScanned = 0;
  const roots = [...options.repoRoots];
  const storeDirs = [...options.storeDirs];

  for (const root of roots) {
    const r = scanTreeForLeaks(root, options.config);
    filesScanned += r.filesScanned;
    allMatches.push(...r.matches);
  }

  for (const storeDir of storeDirs) {
    const r = scanTreeForLeaks(storeDir, {
      ...options.config,
      allowlistPathPrefixes: [],
      allowlistPathContains: [],
    });
    filesScanned += r.filesScanned;
    allMatches.push(...r.matches);
  }

  return {
    roots,
    storeDirs,
    filesScanned,
    matches: allMatches,
  };
}

export function loadLeakPatternsConfig(path: string): LeakPatternsConfig {
  return JSON.parse(readFileSync(path, "utf8")) as LeakPatternsConfig;
}

export function defaultCertStoreDirs(homeDir: string): string[] {
  const base = join(homeDir, ".usesteady");
  const dirs: string[] = [];
  try {
    for (const name of readdirSync(base)) {
      if (name.startsWith("store-cert")) {
        dirs.push(join(base, name));
      }
    }
  } catch {
    // no store
  }
  const envDir = process.env["USESTEADY_STORE_DIR"]?.trim();
  if (envDir) {
    dirs.push(envDir);
  }
  return [...new Set(dirs)];
}
