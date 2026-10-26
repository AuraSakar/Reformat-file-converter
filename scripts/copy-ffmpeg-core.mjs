import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = path.join(root, 'public', 'ffmpeg');
const manifestPath = path.join(targetDir, 'manifest.json');
const packagePath = path.join(root, 'node_modules', '@ffmpeg', 'core', 'package.json');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

const { version } = await readJson(packagePath) ?? {};
if (!version) {
  throw new Error('Cannot find @ffmpeg/core. Run npm install first.');
}

const manifest = await readJson(manifestPath);
const complete =
  manifest?.version === version &&
  (await Promise.all(files.map((file) => exists(path.join(targetDir, file))))).every(Boolean);

if (complete) {
  process.stdout.write(`FFmpeg core ${version} is already available in public/ffmpeg.\n`);
} else {
  await mkdir(targetDir, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }
  await writeFile(manifestPath, `${JSON.stringify({ version, generated: true }, null, 2)}\n`);
  process.stdout.write(`Copied FFmpeg core ${version} to public/ffmpeg.\n`);
}
