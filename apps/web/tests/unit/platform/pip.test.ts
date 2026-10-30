/**
 * Tests for apps/web/src/platform/pip.ts with a fake Document Picture-in-Picture API and fake
 * documents: no API gives NO_PIP; opening copies the page's styles (rules as text, unreadable
 * sheets linked), renders into a container in the new window and titles it; opening again
 * brings the same window back instead of a second one; the window closing (pagehide) unmounts
 * the view; closePictureInPicture() closes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PIP_SIZE,
  closePictureInPicture,
  openPictureInPicture,
  pictureInPicture,
} from '@/platform/pip';

/** A minimal fake element. */
interface FakeElement {
  /** Tag name. */
  tag: string;
  /** Children appended. */
  children: FakeElement[];
  /** Text content (style elements). */
  textContent: string;
  /** rel/href for links. */
  rel?: string;
  /** Link URL. */
  href?: string;
  /** Inline style. */
  style: Record<string, string>;
  /** Appends a child. */
  append: (child: FakeElement) => void;
}

/**
 * A fake element.
 *
 * @param tag Tag name.
 * @returns The element.
 */
function element(tag: string): FakeElement {
  const el: FakeElement = {
    tag,
    children: [],
    textContent: '',
    style: {},
    append: (child) => el.children.push(child),
  };
  return el;
}

/**
 * A fake picture-in-picture window.
 *
 * @returns The window, its head and body, and a function firing pagehide.
 */
function fakeWindow() {
  const head = element('head');
  const body = element('body');
  const listeners: (() => void)[] = [];
  const win = {
    closed: false,
    focus: vi.fn(),
    close: vi.fn(() => {
      win.closed = true;
      for (const listener of listeners) listener();
    }),
    addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
    document: { title: '', head, body, createElement: element },
  };
  return { win, head, body };
}

afterEach(() => {
  closePictureInPicture();
  vi.unstubAllGlobals();
});

describe('pip', () => {
  it('finds the API only where the browser has it', () => {
    expect(pictureInPicture({})).toBeNull();
    expect(
      pictureInPicture({ documentPictureInPicture: { requestWindow: () => undefined } }),
    ).not.toBeNull();
  });

  it('refuses without the API', async () => {
    await expect(openPictureInPicture(() => () => undefined, null)).rejects.toThrow('NO_PIP');
  });

  it('copies styles, renders into the window, reuses it, and unmounts when it closes', async () => {
    vi.stubGlobal('document', {
      styleSheets: [
        { cssRules: [{ cssText: '.a { color: red; }' }], href: null },
        {
          get cssRules(): never {
            throw new Error('cross-origin');
          },
          href: 'https://fonts.example/x.css',
        },
      ],
    });
    const { win, head, body } = fakeWindow();
    const requestWindow = vi.fn(async () => win as unknown as Window);
    const api = { requestWindow, window: null };
    const unmount = vi.fn();
    const render = vi.fn(() => unmount);

    await openPictureInPicture(render, api);
    expect(requestWindow).toHaveBeenCalledWith(PIP_SIZE);
    expect(win.document.title).toBe('Kite (compact)');
    expect(head.children.map((c) => c.tag)).toEqual(['style', 'link']);
    expect(head.children[0]!.textContent).toBe('.a { color: red; }');
    expect(head.children[1]!.href).toBe('https://fonts.example/x.css');
    expect(render).toHaveBeenCalledWith(body.children[0]);

    // Opening again brings the same window back.
    await openPictureInPicture(render, api);
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalled();

    closePictureInPicture();
    expect(win.close).toHaveBeenCalled();
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});
