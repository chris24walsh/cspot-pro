// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import App from './App';

Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false }) });

afterEach(() => window.history.replaceState(null, '', '/'));

it.each(['/app/tv', '/app/?presentation=tv'])('renders the TV without waiting for authentication at %s', path => {
  window.history.replaceState(null, '', path);
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('TV display ready');
  expect(html).not.toContain('auth-shell');
});

it('keeps the media receiver behind authentication', () => {
  window.history.replaceState(null, '', '/app/media');
  expect(renderToStaticMarkup(<App />)).toContain('auth-shell');
});
