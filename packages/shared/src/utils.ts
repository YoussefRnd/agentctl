import type { ProviderDiscovery } from './session-schemas.js';

export function getReadyProviderId(providers: ProviderDiscovery[]) {
  return providers.find((provider) => provider.status === 'ready')?.id ?? 'opencode';
}

export function createTaskSlug(prefix = 'new-session') {
  const now = new Date();
  const date = now.toISOString().split('T')[0].slice(2).replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '').slice(0, 4);
  return `${prefix}-${date}-${time}`;
}

export function validateApiKey(keyName: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'API key is required';
  }
  if (keyName === 'ANTHROPIC_API_KEY') {
    if (!trimmed.startsWith('sk-ant-') && !trimmed.startsWith('sk-')) {
      return 'Anthropic API key must start with "sk-ant-" or "sk-"';
    }
    if (trimmed.length < 20) {
      return 'API key is too short';
    }
  }
  if (keyName === 'OPENAI_API_KEY') {
    if (!trimmed.startsWith('sk-')) {
      return 'OpenAI API key must start with "sk-"';
    }
    if (trimmed.length < 20) {
      return 'API key is too short';
    }
  }
  if (keyName === 'GEMINI_API_KEY') {
    if (!trimmed.startsWith('AIzaSy')) {
      return 'Gemini API key must start with "AIzaSy"';
    }
    if (trimmed.length < 20) {
      return 'API key is too short';
    }
  }
  return null;
}
