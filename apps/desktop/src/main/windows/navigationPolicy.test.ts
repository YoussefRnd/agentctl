import { expect, it } from 'vite-plus/test';
import { isExternalUrl, isRendererNavigation } from './navigationPolicy';
it('keeps native capabilities within the renderer while allowing local hash routing', () => {
  expect(
    isRendererNavigation('file:///app/index.html#/sessions/one', 'file:///app/index.html'),
  ).toBe(true);
  for (const target of ['file:///etc/passwd', 'https://example.com', 'javascript:alert(1)'])
    expect(isRendererNavigation(target, 'file:///app/index.html')).toBe(false);
  expect(isRendererNavigation('http://localhost:5173/sessions/one', 'http://localhost:5173')).toBe(
    true,
  );
  expect(isRendererNavigation('http://localhost:5174', 'http://localhost:5173')).toBe(false);
});
it('permits only named external protocols and handles malformed IPC values', () => {
  for (const value of ['https://example.com', 'http://localhost', 'mailto:user@example.com'])
    expect(isExternalUrl(value)).toBe(true);
  for (const value of [null, {}, 'invalid', 'file:///etc/passwd', 'javascript:alert(1)'])
    expect(isExternalUrl(value)).toBe(false);
});
