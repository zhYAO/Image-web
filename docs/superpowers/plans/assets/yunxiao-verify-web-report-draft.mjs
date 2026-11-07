// Validate completeness of Vitest's merged report against its file inventory.
// This check does not establish that tests or coverage passed by itself.
import fs from 'node:fs';
import path from 'node:path';

try {
  const [inventoryPath, reportPath, ...extra] = process.argv.slice(2);
  if (!inventoryPath || !reportPath || extra.length) throw new Error('Expected inventory and merged report paths');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(inventory) || !inventory.length || !Array.isArray(report.testResults) || report.success !== true) {
    throw new Error('Missing inventory or successful merged result');
  }
  const normalize = (entries, key) => entries.map((entry) => {
    if (!entry || typeof entry[key] !== 'string' || !path.isAbsolute(entry[key])) throw new Error('Invalid test file identity');
    return path.normalize(entry[key]);
  });
  const expected = normalize(inventory, 'file');
  const actual = normalize(report.testResults, 'name');
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size !== expected.length || actualSet.size !== actual.length ||
      expectedSet.size !== actualSet.size || expected.some((item) => !actualSet.has(item))) {
    throw new Error('Merged test-file inventory is incomplete or duplicated');
  }
  console.log(`Verified ${expected.length} distinct Web test files in merged report.`);
} catch (error) {
  console.error(`Web test report rejected: ${error.message}`);
  process.exitCode = 1;
}
