import { jsx as _jsx } from 'react/jsx-runtime';
export const Card = ({ children, className = '' }) => {
  return _jsx('div', {
    className: `liquid-glass rounded-xl overflow-hidden transition-all duration-300 hover:border-white/20 ${className}`,
    children: children,
  });
};
export const CardHeader = ({ children, className = '' }) =>
  _jsx('div', {
    className: `px-4 py-3 border-b border-border bg-glass-surface ${className}`,
    children: children,
  });
export const CardContent = ({ children, className = '' }) =>
  _jsx('div', { className: `px-4 py-4 ${className}`, children: children });
export const CardFooter = ({ children, className = '' }) =>
  _jsx('div', {
    className: `px-4 py-3 border-t border-border bg-glass-surface/50 ${className}`,
    children: children,
  });
//# sourceMappingURL=Card.js.map
