import sax from 'sax';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const FORBIDDEN_ELEMENTS = new Set([
  'animate', 'animatemotion', 'animatetransform', 'audio', 'discard', 'embed', 'foreignobject',
  'iframe', 'object', 'script', 'set', 'style', 'video',
]);

export function isSafeSvg(bytes) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  let depth = 0;
  let rootSeen = false;
  let safe = true;
  const reject = () => { safe = false; };
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, maxEntityCount: 32, maxEntityDepth: 2 });
  parser.onerror = reject;
  parser.ondoctype = reject;
  parser.onsgmldeclaration = reject;
  parser.onprocessinginstruction = ({ name }) => {
    if (rootSeen || name.toLowerCase() !== 'xml') reject();
  };
  parser.ontext = (text) => {
    if (depth === 0 && text.trim() !== '') reject();
  };
  parser.onopentag = (node) => {
    depth += 1;
    const element = node.local.toLowerCase();
    if (node.uri !== SVG_NAMESPACE) reject();
    if (depth === 1) {
      rootSeen = element === 'svg' && node.uri === SVG_NAMESPACE;
      if (!rootSeen) reject();
    } else if (FORBIDDEN_ELEMENTS.has(element)) {
      reject();
    }

    for (const attribute of Object.values(node.attributes)) {
      const name = attribute.local.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'style') reject();
      if (value.includes('\\')) reject();
      if (name === 'href' && value !== '' && !value.startsWith('#')) reject();
      if (attribute.uri === 'http://www.w3.org/2000/xmlns/' && ![SVG_NAMESPACE, XLINK_NAMESPACE].includes(value)) reject();
      if (/\b(?:data|javascript|vbscript):/iu.test(value)) reject();
      for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu)) {
        if (!match[2].trim().startsWith('#')) reject();
      }
    }
  };
  parser.onclosetag = () => { depth -= 1; };

  try {
    parser.write(source).close();
  } catch {
    return false;
  }
  return safe && rootSeen && depth === 0;
}
