import { vi } from 'vitest';

/** Give jsdom the layout and asynchronous scroll events used by virtual lists. */
export function mockVirtualViewport() {
  HTMLElement.prototype.scrollTo ??= () => {};
  const heightOf = (element: HTMLElement): number => {
    if (element.hasAttribute('data-review-file')) {
      const body = element.querySelector<HTMLElement>('[data-diff-scroll] > div');
      return Math.max(
        Number.parseFloat(element.style.minHeight || '0'),
        52 + (Number.parseFloat(body?.style.height ?? '0') || 0),
      );
    }
    if (element.hasAttribute('data-index')) return 18;
    return 600;
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = heightOf(this);
    const file = this.closest<HTMLElement>('[data-review-file]');
    const scroll = this.closest<HTMLElement>('[data-review-scroll]');
    const fileStart = Number.parseFloat(
      file?.style.top || file?.style.transform.match(/translateY\(([^p]+)px\)/)?.[1] || '0',
    );
    const top = file
      ? fileStart + (this.hasAttribute('data-diff-scroll') ? 52 : 0) - (scroll?.scrollTop ?? 0)
      : 0;
    return {
      width: 800,
      height,
      top,
      left: 0,
      bottom: top + height,
      right: 800,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return heightOf(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (
      Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '0') ||
      [...this.querySelectorAll<HTMLElement>('[data-review-file]')].reduce(
        (sum, file) => sum + heightOf(file),
        0,
      ) ||
      600
    );
  });
  return vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  });
}
