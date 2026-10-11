const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2013',
  ndash: '\u2014',
  laquo: '\u00AB',
  raquo: '\u00BB',
  ldquo: '\u00AB',
  rdquo: '\u00BB',
  lsquo: '\u2018',
  rsquo: '\u2019',
  hellip: '\u2026',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
};

function decodeHtmlEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      return isNaN(code) ? match : String.fromCharCode(code);
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      return isNaN(code) ? match : String.fromCharCode(code);
    }
    return HTML_ENTITY_MAP[entity] || match;
  });
}

export function stripHtml(html: string | undefined | null): string {
  if (!html) {
    return '';
  }
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]*>/g, '');
  text = decodeHtmlEntities(text);
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
