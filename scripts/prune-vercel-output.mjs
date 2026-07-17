import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve('.vercel/output/static');
const exactUnusedAssets = new Set([
  'img/MiraconNoIntroClearVersionAestheticAI.mp4',
  'img/kriopigi-detail/MiraconMainVersionAestheticAI.mp4',
  'img/kriopigi-detail/hero-video-optimized.mp4',
  'img/kriopigi-detail/hero-video-stream.mp4',
  'img/hero-bg-web.mp4',
  'img/hero_bg.png',
  'img/golden_visa.png',
  'img/kriopigi-detail/gallery-main.png',
]);
const unusedAssetPatterns = [
  /^img\/ChatGPT Image/i,
  /^img\/Скриншот/i,
  /^img\/project_[^/]+\.png$/i,
  /AestheticAI\.mp4$/i,
  /hero-video-optimized\.mp4$/i,
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    if (entry.isFile()) files.push(absolutePath);
  }

  return files;
}

let outputFiles;
try {
  outputFiles = await walk(outputRoot);
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.log('Vercel static output is absent; nothing to prune.');
    process.exit(0);
  }
  throw error;
}

const unusedFiles = outputFiles.filter((absolutePath) => {
  const relativePath = path.relative(outputRoot, absolutePath).split(path.sep).join('/');
  if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) return false;
  return exactUnusedAssets.has(relativePath) || unusedAssetPatterns.some((pattern) => pattern.test(relativePath));
});

let removedBytes = 0;
for (const absolutePath of unusedFiles) {
  removedBytes += (await stat(absolutePath)).size;
  await unlink(absolutePath);
}

console.log(`Pruned ${unusedFiles.length} unused assets (${(removedBytes / 1024 / 1024).toFixed(1)} MB) from Vercel output.`);
