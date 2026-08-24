import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const functionNames = ['cleanup-worker', 'generation-worker'] as const;

describe('Edge Function dependency reproducibility', () => {
  it.each(functionNames)('%s pins every imported dependency and commits a Deno lockfile', (functionName) => {
    const functionDirectory = resolve(process.cwd(), '../../supabase/functions', functionName);
    const config = JSON.parse(readFileSync(resolve(functionDirectory, 'deno.json'), 'utf8')) as {
      imports: Record<string, string>;
    };

    expect(Object.values(config.imports)).not.toHaveLength(0);
    for (const dependency of Object.values(config.imports)) {
      expect(dependency).not.toMatch(/[@^~](?:latest|next|\^|~)/);
      expect(dependency).not.toMatch(/@\^|@~/);
    }

    const lockfile = JSON.parse(readFileSync(resolve(functionDirectory, 'deno.lock'), 'utf8')) as {
      version?: string;
    };
    expect(lockfile.version).toBeDefined();
  });
});
