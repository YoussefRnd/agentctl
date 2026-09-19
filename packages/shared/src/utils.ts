const ADJECTIVES = [
  'swift',
  'bold',
  'calm',
  'bright',
  'keen',
  'quiet',
  'vivid',
  'agile',
  'cosmic',
  'frost',
  'golden',
  'amber',
  'silver',
  'lunar',
  'solar',
  'azure',
  'mystic',
  'neon',
  'rapid',
  'sage',
  'stellar',
  'subtle',
  'tidal',
  'wild',
  'zephyr',
  'serene',
  'clever',
  'brave',
  'crisp',
  'radiant',
  'noble',
  'lucid',
  'gentle',
  'prime',
  'nimble',
  'vibrant',
  'polar',
  'cedar',
  'alpine',
  'breezy',
  'crystal',
  'emerald',
  'fluent',
  'hardy',
  'jovial',
  'kinetic',
  'mighty',
  'pacific',
  'rustic',
  'spry',
];

const NOUNS = [
  'falcon',
  'otter',
  'orbit',
  'fox',
  'badger',
  'haven',
  'canyon',
  'ridge',
  'forest',
  'harbor',
  'spruce',
  'river',
  'beacon',
  'meadow',
  'peak',
  'phoenix',
  'wave',
  'tiger',
  'aurora',
  'valley',
  'comet',
  'glade',
  'glacier',
  'drift',
  'breeze',
  'shadow',
  'summit',
  'cedar',
  'hawk',
  'lynx',
  'atlas',
  'brook',
  'cascade',
  'dune',
  'echo',
  'fjord',
  'grove',
  'island',
  'lagoon',
  'marsh',
  'nebula',
  'oasis',
  'plateau',
  'quarry',
  'reef',
  'stream',
  'tundra',
  'vortex',
  'willow',
  'zenith',
];

export function createTaskSlug(prefix?: string): string {
  if (prefix && prefix.trim() && prefix.trim().toLowerCase() !== 'new-session') {
    const slug = prefix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (slug) return slug;
  }

  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

export function formatSlugToTitle(slug: string): string {
  if (!slug) return 'New Session';
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
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
