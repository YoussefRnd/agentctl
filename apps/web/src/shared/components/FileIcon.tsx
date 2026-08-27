import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  type FileTreeIcons,
} from '@pierre/trees';
import { memo, useInsertionEffect, useMemo } from 'react';
import type { SVGProps } from 'react';

export interface PierreIconResolution {
  name: string;
  token?: string;
}

const PIERRE_ICON_SPRITE_ID = 'agentctl-pierre-file-icon-sprite';

const CUSTOM_FILE_ICON_SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;">
  <symbol id="agentctl-file-icon-package-json" viewBox="0 0 32 32">
    <path d="M2 2H30V30H2" fill="#c12127" />
    <path d="M7.25 7.25h17.5v17.5h-3.5v-14H16v14H7.25" fill="#fff" />
  </symbol>
  <symbol id="agentctl-file-icon-tsconfig" viewBox="0 0 32 32">
    <path d="M23.827 8.243a4.424 4.424 0 0 1 2.223 1.281 5.853 5.853 0 0 1 .852 1.143c.011.045-1.534 1.083-2.471 1.662-.034.023-.169-.124-.322-.35a2.014 2.014 0 0 0-1.67-1c-1.077-.074-1.771.49-1.766 1.433a1.3 1.3 0 0 0 .153.666c.237.49.677.784 2.059 1.383 2.544 1.1 3.636 1.817 4.31 2.843a5.158 5.158 0 0 1 .416 4.333 4.764 4.764 0 0 1-3.932 2.815 10.9 10.9 0 0 1-2.708-.028 6.531 6.531 0 0 1-3.616-1.884 6.278 6.278 0 0 1-.926-1.371 2.655 2.655 0 0 1 .327-.208c.158-.09.756-.434 1.32-.761l1.024-.6.214.312a4.771 4.771 0 0 0 1.35 1.292 3.3 3.3 0 0 0 3.458-.175 1.545 1.545 0 0 0 .2-1.974c-.276-.4-.84-.727-2.443-1.422a8.8 8.8 0 0 1-3.349-2.055 4.687 4.687 0 0 1-.976-1.777 7.116 7.116 0 0 1-.062-2.268 4.332 4.332 0 0 1 3.644-3.374 9 9 0 0 1 2.71.01ZM15.484 9.726l.011 1.454h-4.63v13.148H7.6V11.183H2.97V9.755a13.986 13.986 0 0 1 .04-1.466c.017-.023 2.832-.034 6.245-.028l6.211.017Z" fill="#007acc" />
    <path d="m27.075 25.107.363-.361c1.68.055 1.706 0 1.78-.177l.462-1.124.034-.107-.038-.093c-.02-.049-.081-.2-1.13-1.2v-.526c1.211-1.166 1.185-1.226 1.116-1.4l-.46-1.136c-.069-.17-.1-.237-1.763-.191l-.364-.367a8.138 8.138 0 0 0-.057-1.657l-.047-.106-1.2-.525c-.177-.081-.239-.11-1.372 1.124l-.509-.008c-1.167-1.245-1.222-1.223-1.4-1.152l-1.115.452c-.175.071-.236.1-.169 1.79l-.36.359c-1.68-.055-1.7 0-1.778.177L18.606 20l-.036.108.038.094c.02.048.078.194 1.13 1.2v.525c-1.211 1.166-1.184 1.226-1.115 1.4l.459 1.137c.07.174.1.236 1.763.192l.363.377a8.169 8.169 0 0 0 .055 1.654l.047.107 1.208.528c.176.073.236.1 1.366-1.13l.509.006c1.168 1.247 1.228 1.223 1.4 1.154l1.113-.45c.176-.075.237-.102.169-1.795Zm-4.788-2.632a2 2 0 1 1 2.618 1.14 2.023 2.023 0 0 1-2.618-1.14Z" fill="#99b8c4" />
  </symbol>
  <symbol id="agentctl-file-icon-pnpm" viewBox="0 0 32 32">
    <path fill="#f9ad00" d="M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z" />
    <path fill="currentColor" d="M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z" />
  </symbol>
</svg>`;

export const AGENTCTL_PIERRE_ICONS = {
  set: 'complete',
  colored: true,
  spriteSheet: CUSTOM_FILE_ICON_SPRITE,
  byFileName: {
    'package.json': 'agentctl-file-icon-package-json',
    'tsconfig.json': 'agentctl-file-icon-tsconfig',
    'pnpm-lock.yaml': 'agentctl-file-icon-pnpm',
    'pnpm-workspace.yaml': 'agentctl-file-icon-pnpm',
  },
} satisfies FileTreeIcons;

const iconResolver = createFileTreeIconResolver(AGENTCTL_PIERRE_ICONS);

export function ensurePierreIconSprite(): void {
  if (typeof document === 'undefined' || document.getElementById(PIERRE_ICON_SPRITE_ID)) return;
  const container = document.createElement('div');
  container.id = PIERRE_ICON_SPRITE_ID;
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'absolute';
  container.style.width = '0';
  container.style.height = '0';
  container.style.overflow = 'hidden';
  container.style.display = 'none';
  container.style.pointerEvents = 'none';
  container.innerHTML = `${getBuiltInSpriteSheet('complete')}${CUSTOM_FILE_ICON_SPRITE}`;
  document.body.prepend(container);
}

export function resolvePierreIconForEntry(
  pathValue: string,
  kind: 'file' | 'directory' = 'file',
): PierreIconResolution | null {
  if (kind === 'directory') return null;
  return iconResolver.resolveIcon('file-tree-icon-file', pathValue);
}

const ICON_COLORS: Record<string, readonly [light: string, dark: string]> = {
  astro: ['#a631be', '#d568ea'],
  babel: ['#d5a910', '#ffd452'],
  bash: ['#199f43', '#5ecc71'],
  biome: ['#1a85d4', '#69b1ff'],
  bootstrap: ['#693acf', '#9d6afb'],
  browserslist: ['#d5a910', '#ffd452'],
  bun: ['#594c5b', '#79697b'],
  c: ['#1a85d4', '#69b1ff'],
  claude: ['#d47628', '#ffa359'],
  cpp: ['#1a85d4', '#69b1ff'],
  css: ['#693acf', '#9d6afb'],
  database: ['#a631be', '#d568ea'],
  default: ['#84848a', '#adadb1'],
  docker: ['#1a85d4', '#69b1ff'],
  eslint: ['#693acf', '#9d6afb'],
  git: ['#ff8c5b', '#d5512f'],
  go: ['#1ca1c7', '#68cdf2'],
  graphql: ['#d32a61', '#ff678d'],
  html: ['#d47628', '#ffa359'],
  image: ['#d32a61', '#ff678d'],
  javascript: ['#d5a910', '#ffd452'],
  json: ['#d47628', '#ffa359'],
  markdown: ['#199f43', '#5ecc71'],
  mcp: ['#17a5af', '#64d1db'],
  nextjs: ['#84848a', '#adadb1'],
  npm: ['#d52c36', '#ff6762'],
  oxc: ['#1ca1c7', '#68cdf2'],
  postcss: ['#d52c36', '#ff6762'],
  prettier: ['#17a5af', '#64d1db'],
  python: ['#1a85d4', '#69b1ff'],
  react: ['#1ca1c7', '#68cdf2'],
  ruby: ['#d52c36', '#ff6762'],
  rust: ['#d47628', '#ffa359'],
  sass: ['#d32a61', '#ff678d'],
  stylelint: ['#84848a', '#adadb1'],
  svelte: ['#d52c36', '#ff6762'],
  svg: ['#d47628', '#ffa359'],
  svgo: ['#199f43', '#5ecc71'],
  swift: ['#d47628', '#ffa359'],
  table: ['#17a5af', '#64d1db'],
  tailwind: ['#1ca1c7', '#68cdf2'],
  terraform: ['#693acf', '#9d6afb'],
  text: ['#84848a', '#adadb1'],
  typescript: ['#1a85d4', '#69b1ff'],
  vite: ['#a631be', '#d568ea'],
  vscode: ['#1a85d4', '#69b1ff'],
  vue: ['#199f43', '#5ecc71'],
  wasm: ['#693acf', '#9d6afb'],
  webpack: ['#1a85d4', '#69b1ff'],
  yml: ['#d52c36', '#ff6762'],
  zig: ['#d47628', '#ffa359'],
  zip: ['#d47628', '#ffa359'],
};

interface FileIconProps extends SVGProps<SVGSVGElement> {
  path: string;
  size?: number | string;
  kind?: 'file' | 'directory';
}

export const FileIcon = memo(function FileIcon({
  path,
  size = 15,
  kind = 'file',
  className = '',
  style,
  ...props
}: FileIconProps) {
  useInsertionEffect(ensurePierreIconSprite, []);

  const icon = useMemo(() => resolvePierreIconForEntry(path, kind), [path, kind]);

  if (!icon) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`text-text-muted/70 shrink-0 ${className}`}
        {...props}
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }

  const colors = ICON_COLORS[icon.token ?? 'default'] ?? ICON_COLORS.default;
  const tokenColor = colors[1]; // Dark theme color (default in Agentctl dark-first UI)

  return (
    <svg
      aria-hidden="true"
      data-pierre-icon={icon.name}
      data-icon-token={icon.token}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      style={{ color: tokenColor, ...style }}
      {...props}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
});
