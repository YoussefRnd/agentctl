function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function metadata(value: unknown, limit = 512): string {
  // Protocol metadata is rendered inline; strip controls before adding it to the transcript.
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, limit) : '';
}

function resourceUri(value: unknown): string {
  const uri = metadata(value, 2048).trim();
  // A data URI contains the binary payload, rather than a retrievable reference.
  return /^(data|javascript|vbscript):/i.test(uri) ? '' : uri;
}

/** Display content without copying binary payloads or provider metadata into the transcript. */
export function displayAcpContent(block: unknown): string {
  const content = record(block);
  if (!content) return '\n\n[Unsupported ACP content]\n\n';
  switch (content.type) {
    case 'text':
      return typeof content.text === 'string' ? content.text : '';
    case 'resource_link': {
      const label = metadata(content.title) || metadata(content.name) || 'Resource';
      const description = metadata(content.description, 2048);
      const uri = resourceUri(content.uri);
      return `\n\n${label}${description ? `: ${description}` : ''}${uri ? `\n${uri}` : ''}\n\n`;
    }
    case 'resource': {
      const resource = record(content.resource);
      if (typeof resource?.text === 'string') return resource.text;
      return placeholder('binary resource', resource?.mimeType, resource?.uri);
    }
    case 'image':
      return placeholder('image', content.mimeType, content.uri);
    case 'audio':
      return placeholder('audio', content.mimeType);
    default:
      return `\n\n[Unsupported ACP content: ${metadata(content.type, 128) || 'unknown'}]\n\n`;
  }
}

function placeholder(kind: string, mime: unknown, reference?: unknown): string {
  const mimeType = metadata(mime, 256);
  const uri = resourceUri(reference);
  return `\n\n[ACP ${kind}${mimeType ? ` (${mimeType})` : ''}${uri ? `: ${uri}` : ''}]\n\n`;
}
