import type { HTMLAttributes } from 'react';

type IconProps = HTMLAttributes<HTMLSpanElement>;

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

export const Menu = createIcon('\u2261');
export const PanelRight = createIcon('\u25A5');
export const Folder = createIcon('\uD83D\uDCC1');
export const Plus = createIcon('+');
export const Search = createIcon('\u2315');
export const ArrowUpDown = createIcon('\u21C5');
export const ChevronRight = createIcon('\u203A');
export const ChevronDown = createIcon('\u2304');
export const Loader2 = createIcon('\u27F3');
export const AlertCircle = createIcon('!');
export const Sparkles = createIcon('\u2726');
export const GitBranch = createIcon('\u2387');
export const Send = createIcon('\u27A4');
export const ChevronUp = createIcon('\u2303');
export const Zap = createIcon('\u26A1');
export const Paperclip = createIcon('\u2341');
export const Bot = createIcon('\u25C9');
export const Cpu = createIcon('\u25AB');
export const LogIn = createIcon('\u21E2');
export const ShieldCheck = createIcon('\uD83D\uDEE1');
export const X = createIcon('\u00D7');
export const Check = createIcon('\u2713');
export const Terminal = createIcon('>');
export const Eye = createIcon('\u25D4');
export const FileCheck = createIcon('\u2611');
export const GitPullRequest = createIcon('\u21BA');
export const CheckCircle2 = createIcon('\u25C9');
export const Circle = createIcon('\u25CB');
export const FileText = createIcon('\u2261');
export const Home = createIcon('\u2302');
export const ChevronLeft = createIcon('\u2039');
