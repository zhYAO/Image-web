import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export async function regularFiles(root, prefix = '') {
  const files = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (/[\\\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') throw new Error('Invalid static payload path');
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error('Nonregular static payload');
    if (stat.isDirectory()) files.push(...await regularFiles(root, path));
    else if (!stat.isFile() || stat.nlink !== 1) throw new Error('Nonregular static payload');
    else files.push({ path, bytes: stat.size });
  }
  const normalized = files.map(file => file.path.normalize('NFC').toLowerCase());
  if (new Set(normalized).size !== files.length) throw new Error('Conflicting static payload paths');
  return files;
}
