// Explicit candidate-job provisioning only. The normal application never downloads fonts.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const revision = 'f8d157532fbfaeda587e826d4cd5b21a49186f7c';
export const fingerprints = Object.freeze({
  'NotoSansCJKsc-Regular.otf': '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
  'NotoSansCJKsc-Bold.otf': 'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a',
  'LICENSE.txt': '88f117575237307bdd86a17ef15e21790fc9a662fe4dfb103ca1ca077f0d9982',
  'README.md': 'f314e6e822b03543d7403eb3f8331208d52356a27fe1391216d23d7599583c58',
});

function downloadOfficial(url, output) {
  execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--tlsv1.2', '--connect-timeout', '30', '--max-time', '180', '--output', output, url],
  { stdio: ['ignore', 'ignore', 'inherit'] });
}

export async function prepareCandidateFonts({ source, runnerTemp, project, download = downloadOfficial }) {
  // Explicit administrator input remains authoritative. The existing packager
  // applies its ancestor/link/exact-four-file/hash checks to this source as before.
  if (source) return source;
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) throw Error('Expected absolute RUNNER_TEMP');
  const directory = await mkdtemp(path.join(runnerTemp, 'zimage-candidate-fonts-'));
  for (const weight of ['Regular', 'Bold']) {
    const name = `NotoSansCJKsc-${weight}.otf`;
    const url = `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/Sans/OTF/SimplifiedChinese/${name}`;
    await download(url, path.join(directory, name));
    if (createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex') !== fingerprints[name])
      throw Error(`Pinned original font SHA-256 mismatch: ${name}`);
  }
  // Same byte reconstruction as the audited quality job. Do not replace the
  // original license/provenance with upstream files or generated descriptions.
  for (const name of ['LICENSE.txt', 'README.md']) {
    const text = await readFile(path.join(project, 'doc/licenses/apparel-noto', name), 'utf8');
    await writeFile(path.join(directory, name), text.replace(/\r?\n/g, '\r\n'), { flag: 'wx' });
    if (createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex') !== fingerprints[name])
      throw Error(`Original license/provenance SHA-256 mismatch: ${name}`);
  }
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await prepareCandidateFonts({ source: process.env.FONT_SOURCE,
    runnerTemp: process.env.RUNNER_TEMP, project: process.cwd() });
  // JSON avoids treating a configured path as shell syntax.
  process.stdout.write(JSON.stringify(source));
}
