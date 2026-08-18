import {createElement, Fragment, ReactNode} from 'react';

/**
 * Rendering an Indico abstract safely.
 *
 * Abstracts are HTML written by organisers and speakers, and they genuinely
 * need formatting — italics for species names, sub/sup for formulae, lists for
 * methods. So stripping to plain text loses real meaning, and
 * `dangerouslySetInnerHTML` would let anyone who can edit a contribution run
 * script in this app.
 *
 * The middle path: parse the HTML with `DOMParser` (which does not execute
 * anything, since the document is inert and never attached to the page), then
 * rebuild it as React elements from an allow-list. Anything not on the list is
 * dropped, keeping its text. No attributes survive at all except a link's href,
 * and that only when it is http(s).
 */

const ALLOWED = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
]);

/** Headings inside an abstract should not compete with the app's own. */
const DOWNGRADE: Record<string, string> = {h1: 'strong', h2: 'strong', h3: 'strong', h4: 'strong', h5: 'strong', h6: 'strong'};

function safeHref(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function convert(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, index) => convert(child, index));

  if (!ALLOWED.has(tag)) {
    // Unknown element: keep what it said, discard how it said it. This is what
    // makes a stray <script> or <iframe> harmless rather than merely blocked.
    return <Fragment key={key}>{children}</Fragment>;
  }

  if (tag === 'br') {
    return <br key={key} />;
  }

  if (tag === 'a') {
    const href = safeHref(element.getAttribute('href'));
    return href ? (
      <a key={key} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <Fragment key={key}>{children}</Fragment>
    );
  }

  return createElement(DOWNGRADE[tag] ?? tag, {key}, ...children);
}

/** Parse `html` into React nodes, keeping only safe, meaningful formatting. */
export function RichText({html}: {html: string}) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return <>{Array.from(parsed.body.childNodes).map((node, index) => convert(node, index))}</>;
}

/** Plain-text version, for previews and for search. */
export function toPlainText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
