import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../utils.js';

const PendingSurface = createContext(false);

export function useSkeletonPending() {
  return useContext(PendingSurface);
}

type Shape = { x: number; y: number; width: number; height: number; radius: string };
const VISUAL =
  'button, input, textarea, select, [role="button"], [role="switch"], [role="combobox"], img, svg, canvas, video';

/**
 * Mask the rendered presentation, without a second placeholder tree. Children still mount:
 * pass presentation components with data/actions supplied by their parent, never fetchers.
 */
export function SkeletonSurface({
  pending = true,
  message = 'Loading…',
  children,
  className,
}: {
  pending?: boolean;
  message?: string;
  children: ReactNode;
  className?: string;
}) {
  const inherited = useContext(PendingSurface);
  const active = pending && !inherited;
  const content = useRef<HTMLDivElement>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);

  useLayoutEffect(() => {
    const element = content.current;
    if (!active || !element) return;
    let frame: number | undefined;
    let disposed = false;
    const measure = () => {
      frame = undefined;
      const origin = element.getBoundingClientRect();
      const next: Shape[] = [];
      const opaque = new Set<Element>();
      const visible = (node: Element) => {
        for (
          let parent: Element | null = node;
          parent && parent !== element;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.opacity === '0' || parent.hasAttribute('hidden'))
            return false;
        }
        return true;
      };
      const insideControl = (node: Element | null) => {
        for (let parent = node; parent && parent !== element; parent = parent.parentElement) {
          if (opaque.has(parent)) return true;
        }
        return false;
      };
      const add = (rect: DOMRect, radius: string, owner: Element) => {
        let { left, top, right, bottom } = rect;
        for (
          let parent: Element | null = owner;
          parent && parent !== element;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX || style.overflow)) {
            left = Math.max(left, bounds.left);
            right = Math.min(right, bounds.right);
          }
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY || style.overflow)) {
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
          }
        }
        if (right <= left || bottom <= top) return;
        next.push({
          x: left - origin.left,
          y: top - origin.top,
          width: right - left,
          height: bottom - top,
          radius,
        });
      };
      for (const node of element.querySelectorAll(VISUAL)) {
        if (insideControl(node.parentElement) || !visible(node)) continue;
        // Summary/disclosure buttons contain an entire row: mask their contents individually.
        if (
          node.tagName === 'BUTTON' &&
          (node.classList.contains('flex-1') ||
            node.querySelector('h1, h2, h3, h4, p, [class*="flex-col"]'))
        )
          continue;
        opaque.add(node);
        const style = getComputedStyle(node);
        add(
          node.getBoundingClientRect(),
          style.borderRadius || '0.375rem',
          node.parentElement ?? element,
        );
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (
          !parent ||
          !node.textContent?.trim() ||
          !visible(parent) ||
          insideControl(parent) ||
          parent.closest('script, style, [aria-hidden="true"].sr-only, .sr-only')
        )
          continue;
        if (!parent.getClientRects().length) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) add(rect, '0.25rem', parent);
      }
      for (const node of element.querySelectorAll('*')) {
        if (node.childNodes.length || opaque.has(node) || insideControl(node) || !visible(node))
          continue;
        const style = getComputedStyle(node);
        if (
          style.backgroundColor &&
          style.backgroundColor !== 'transparent' &&
          style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ) {
          add(node.getBoundingClientRect(), style.borderRadius || '0.25rem', node);
        }
      }
      setShapes((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const schedule = () => {
      if (!disposed && frame === undefined) frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    // Theme/font variables can change glyph widths without resizing this block.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      mutations.observe(ancestor, { attributes: true });
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [active]);

  return (
    <PendingSurface value={inherited || pending}>
      <div className={cn('relative', className)}>
        {active && (
          <div role="status" aria-live="polite">
            <span className="sr-only">{message}</span>
          </div>
        )}
        <div
          ref={content}
          aria-hidden={active || undefined}
          inert={active || undefined}
          style={active ? { visibility: 'hidden' } : undefined}
          onFocusCapture={
            pending
              ? (event) => {
                  if (event.target instanceof HTMLElement) event.target.blur();
                }
              : undefined
          }
          onKeyDownCapture={
            pending
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
              : undefined
          }
          onChangeCapture={
            pending
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
              : undefined
          }
          onClickCapture={
            pending
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
              : undefined
          }
          onSubmitCapture={
            pending
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
              : undefined
          }
        >
          {children}
        </div>
        {active && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            {shapes.map((shape, index) => (
              <span
                key={index}
                data-skeleton-shape=""
                className="bg-surface-tertiary/60 absolute animate-pulse motion-reduce:animate-none"
                style={{
                  left: shape.x,
                  top: shape.y,
                  width: shape.width,
                  height: shape.height,
                  borderRadius: shape.radius,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </PendingSurface>
  );
}
