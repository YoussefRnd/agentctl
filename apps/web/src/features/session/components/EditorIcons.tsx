import React, { type SVGProps, useId } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

const CursorIcon: React.FC<IconProps> = ({ className, ...props }) => (
  <svg {...props} viewBox="0 0 466.73 532.09" fill="currentColor" className={className}>
    <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
  </svg>
);

const VisualStudioCodeIcon: React.FC<IconProps> = (props) => {
  const id = useId();
  const maskId = `${id}-vscode-mask`;

  return (
    <svg {...props} fill="none" viewBox="0 0 100 100">
      <mask id={maskId} width="100" height="100" x="0" y="0" maskUnits="userSpaceOnUse">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
          clipRule="evenodd"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          fill="#0065A9"
          d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
        />
        <path
          fill="#007ACC"
          d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
        />
        <path
          fill="#1F9CF0"
          d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
        />
      </g>
    </svg>
  );
};

const VisualStudioCodeInsidersIcon: React.FC<IconProps> = (props) => {
  const id = useId();
  const maskId = `${id}-vscode-insiders-mask`;

  return (
    <svg {...props} fill="none" viewBox="0 0 100 100">
      <mask id={maskId} width="100" height="100" x="0" y="0" maskUnits="userSpaceOnUse">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
          clipRule="evenodd"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          fill="#009a7c"
          d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
        />
        <path
          fill="#00b294"
          d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
        />
        <path
          fill="#24bfa5"
          d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
        />
      </g>
    </svg>
  );
};

const ZedIcon: React.FC<IconProps> = (props) => (
  <svg {...props} fill="currentColor" viewBox="0 0 96 96">
    <path
      fillRule="evenodd"
      d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z"
      clipRule="evenodd"
    />
  </svg>
);

const AntigravityIcon: React.FC<IconProps> = (props) => (
  <svg {...props} viewBox="0 0 16 16" fill="currentColor">
    <path d="M14.1452 14.6818C14.9937 15.3182 16.2664 14.894 15.0997 13.7273C11.5998 10.3333 12.3421 1 7.99366 1C3.64518 1 4.3876 10.3333 0.887603 13.7273C-0.385123 15 0.993664 15.3182 1.84215 14.6818C5.13002 12.4545 4.9179 8.5303 7.99366 8.5303C11.0694 8.5303 10.8573 12.4545 14.1452 14.6818Z" />
  </svg>
);

const SublimeTextIcon: React.FC<IconProps> = (props) => (
  <svg {...props} viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.2 6.8L12.5 2a1.3 1.3 0 0 0-1.3 0L2.5 6.8c-.8.5-1.3 1.3-1.3 2.2v6c0 .9.5 1.7 1.3 2.2l8.7 4.8c.4.2.8.3 1.3.3s.9-.1 1.3-.3l8.7-4.8c.8-.5 1.3-1.3 1.3-2.2V9c0-.9-.5-1.7-1.3-2.2zM12 4.2l6.5 3.6-6.5 3.6-6.5-3.6L12 4.2zm-7.6 6.3l6.5 3.6v6.6l-6.5-3.6v-6.6zm15.2 6.6l-6.5 3.6v-6.6l6.5-3.6v6.6z" />
  </svg>
);

const JetBrainsIcon: React.FC<IconProps> = (props) => (
  <svg {...props} viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="12" fill="#000" />
    <path d="M12 12h40v40H12z" fill="#000" />
    <path fill="#FF318C" d="M14 14h18v18H14z" />
    <path fill="#00D886" d="M32 32h18v18H32z" />
    <path fill="#fff" d="M18 46h28v4H18z" />
  </svg>
);

export function EditorBrandIcon({ editorId, ...props }: IconProps & { editorId: string }) {
  switch (editorId) {
    case 'cursor':
      return <CursorIcon {...props} />;
    case 'vscode':
      return <VisualStudioCodeIcon {...props} />;
    case 'vscode-insiders':
      return <VisualStudioCodeInsidersIcon {...props} />;
    case 'vscodium':
      return <VisualStudioCodeIcon {...props} />;
    case 'zed':
      return <ZedIcon {...props} />;
    case 'antigravity':
      return <AntigravityIcon {...props} />;
    case 'sublime':
      return <SublimeTextIcon {...props} />;
    case 'idea':
    case 'webstorm':
    case 'pycharm':
    case 'goland':
    case 'rustrover':
    case 'clion':
    case 'rider':
    case 'phpstorm':
    case 'datagrip':
    case 'dataspell':
    case 'rubymine':
    case 'aqua':
      return <JetBrainsIcon {...props} />;
    default:
      return <VisualStudioCodeIcon {...props} />;
  }
}
