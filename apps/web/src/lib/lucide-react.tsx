import type { HTMLAttributes } from 'react';

interface IconProps extends HTMLAttributes<HTMLSpanElement> {}

const createIcon = (glyph: string) => {
  return function Icon({ className = '', ...props }: IconProps) {
    return (
      <span
        {...props}
        className={`inline-flex items-center justify-center leading-none ${className}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
    );
  };
};

export const Menu = createIcon('≡');
export const PanelRight = createIcon('▥');
export const Folder = createIcon('📁');
export const Plus = createIcon('+');
export const Search = createIcon('⌕');
export const ArrowUpDown = createIcon('⇅');
export const ChevronRight = createIcon('›');
export const ChevronDown = createIcon('⌄');
export const Loader2 = createIcon('⟳');
export const AlertCircle = createIcon('!');
export const Sparkles = createIcon('✦');
export const GitBranch = createIcon('⎇');
export const Send = createIcon('➤');
export const ChevronUp = createIcon('⌃');
export const Zap = createIcon('⚡');
export const Paperclip = createIcon('⌁');
export const Bot = createIcon('◉');
export const Cpu = createIcon('◫');
export const LogIn = createIcon('⇢');
export const ShieldCheck = createIcon('🛡');
export const X = createIcon('×');
export const Check = createIcon('✓');
export const Terminal = createIcon('>');
export const Eye = createIcon('◔');
export const FileCheck = createIcon('☑');
export const GitPullRequest = createIcon('↺');
export const CheckCircle2 = createIcon('◉');
export const Circle = createIcon('○');
export const FileText = createIcon('≡');
export const Home = createIcon('⌂');
export const ChevronLeft = createIcon('‹');
