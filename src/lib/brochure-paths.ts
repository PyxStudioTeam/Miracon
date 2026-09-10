const legacyBrochurePaths: Readonly<Record<string, string>> = Object.freeze({
  '/brochures/A4 Artemis_compressed.pdf': '/brochures/a4-artemis-compressed.pdf',
  '/brochures/A4%20Artemis_compressed.pdf': '/brochures/a4-artemis-compressed.pdf',
  '/brochures/Kriopigi Villas_compressed.pdf': '/brochures/kriopigi-villas-compressed.pdf',
  '/brochures/Kriopigi%20Villas_compressed.pdf': '/brochures/kriopigi-villas-compressed.pdf',
});

export function normalizeBrochurePath(path: string): string {
  return legacyBrochurePaths[path] ?? path;
}
