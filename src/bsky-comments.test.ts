// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { BskyComments } from './bsky-comments';

const el = new BskyComments();
const escapeHtml = (str: string) => (el as any)['escapeHtml'](str);
const renderRichText = (record: any) => (el as any)['renderRichText'](record);

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(escapeHtml('Hello world 123')).toBe('Hello world 123');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;'
    );
  });
});

describe('renderRichText', () => {
  it('returns escaped text when no facets', () => {
    expect(renderRichText({ text: 'Hello <world>', facets: [] })).toBe(
      'Hello &lt;world&gt;'
    );
  });

  it('returns escaped text when facets is undefined', () => {
    expect(renderRichText({ text: 'Hello' })).toBe('Hello');
  });

  it('renders a link facet', () => {
    const text = 'Check out example.com for more';
    const encoder = new TextEncoder();
    const start = text.indexOf('example.com');
    const byteStart = encoder.encode(text.slice(0, start)).length;
    const byteEnd = byteStart + encoder.encode('example.com').length;

    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      }],
    });

    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('>example.com</a>');
    expect(result).toContain('Check out ');
    expect(result).toContain(' for more');
  });

  it('renders a mention facet', () => {
    const text = 'Hello @alice.bsky.social!';
    const encoder = new TextEncoder();
    const start = text.indexOf('@alice');
    const byteStart = encoder.encode(text.slice(0, start)).length;
    const byteEnd = byteStart + encoder.encode('@alice.bsky.social').length;

    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc123' }],
      }],
    });

    expect(result).toContain('href="https://bsky.app/profile/did%3Aplc%3Aabc123"');
    expect(result).toContain('>@alice.bsky.social</a>');
  });

  it('renders a hashtag facet', () => {
    const text = 'Love #typescript!';
    const encoder = new TextEncoder();
    const start = text.indexOf('#typescript');
    const byteStart = encoder.encode(text.slice(0, start)).length;
    const byteEnd = byteStart + encoder.encode('#typescript').length;

    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'typescript' }],
      }],
    });

    expect(result).toContain('href="https://bsky.app/hashtag/typescript"');
    expect(result).toContain('>#typescript</a>');
  });

  it('handles multiple facets in correct order', () => {
    const text = 'Hi @bob check example.com';
    const encoder = new TextEncoder();

    const mentionStart = encoder.encode(text.slice(0, text.indexOf('@bob'))).length;
    const mentionEnd = mentionStart + encoder.encode('@bob').length;

    const linkStart = encoder.encode(text.slice(0, text.indexOf('example.com'))).length;
    const linkEnd = linkStart + encoder.encode('example.com').length;

    const result = renderRichText({
      text,
      facets: [
        {
          index: { byteStart: linkStart, byteEnd: linkEnd },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        },
        {
          index: { byteStart: mentionStart, byteEnd: mentionEnd },
          features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:bob' }],
        },
      ],
    });

    const mentionPos = result.indexOf('@bob');
    const linkPos = result.indexOf('example.com');
    expect(mentionPos).toBeLessThan(linkPos);
    expect(result).toContain('Hi ');
    expect(result).toContain(' check ');
  });

  it('handles multi-byte characters (emoji) with correct byte offsets', () => {
    const text = '🎉 Hello world';
    const encoder = new TextEncoder();
    // 🎉 is 4 bytes, space is 1, so "Hello" starts at byte 5
    const byteStart = encoder.encode('🎉 ').length;
    const byteEnd = byteStart + encoder.encode('Hello').length;

    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://hello.com' }],
      }],
    });

    expect(result).toContain('🎉 ');
    expect(result).toContain('>Hello</a>');
    expect(result).toContain(' world');
  });

  it('skips facets with out-of-bounds byte offsets', () => {
    const text = 'Short';
    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart: 0, byteEnd: 999 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.com' }],
      }],
    });

    expect(result).toBe('Short');
  });

  it('skips overlapping facets', () => {
    const text = 'Hello world test';

    const result = renderRichText({
      text,
      facets: [
        {
          index: { byteStart: 0, byteEnd: 11 }, // "Hello world"
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.com' }],
        },
        {
          index: { byteStart: 6, byteEnd: 11 }, // "world" — overlaps
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://b.com' }],
        },
      ],
    });

    // First facet should render, overlapping second should be skipped
    expect(result).toContain('href="https://a.com"');
    expect(result).not.toContain('href="https://b.com"');
  });

  it('escapes XSS in facet URIs', () => {
    const text = 'Click here';
    const encoder = new TextEncoder();

    const result = renderRichText({
      text,
      facets: [{
        index: { byteStart: 0, byteEnd: encoder.encode(text).length },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert("xss")' }],
      }],
    });

    expect(result).not.toContain('javascript:alert("xss")');
    expect(result).toContain('&quot;');
  });
});
