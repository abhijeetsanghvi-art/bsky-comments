const DEFAULT_API = 'https://public.api.bsky.app/xrpc';

interface BlueskyPost {
  uri: string;
  author: {
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  record: {
    text: string;
    createdAt: string;
    facets?: Array<{
      index: { byteStart: number; byteEnd: number };
      features: Array<{
        $type: string;
        uri?: string;
        did?: string;
        tag?: string;
      }>;
    }>;
  };
  indexedAt: string;
  likeCount?: number;
  replyCount?: number;
}

interface BlueskyThreadNode {
  post: BlueskyPost;
  replies?: BlueskyThreadNode[];
}

/**
 * <bsky-comments> Web Component
 */
export class BskyComments extends HTMLElement {
  private _post: string | null = null;
  private _uri: string | null = null;
  private _service: string = DEFAULT_API;
  private _iconLike: string = '❤️';
  private _iconReply: string = '💬';
  private _sortOrder: 'asc' | 'desc' = 'asc';
  private _depth: number = 10;
  
  private _data: BlueskyThreadNode | null = null;
  private _loading: boolean = false;
  private _error: string | null = null;
  private _connected: boolean = false;
  private _abortController: AbortController | null = null;

  static get observedAttributes() {
    return ['post', 'uri', 'service', 'icon-like', 'icon-reply', 'sort', 'depth'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return;
    
    switch (name) {
      case 'post': this._post = newValue; break;
      case 'uri': this._uri = newValue; break;
      case 'service': this._service = newValue || DEFAULT_API; break;
      case 'icon-like': this._iconLike = newValue || '❤️'; break;
      case 'icon-reply': this._iconReply = newValue || '💬'; break;
      case 'sort': this._sortOrder = (newValue === 'desc') ? 'desc' : 'asc'; break;
      case 'depth': this._depth = Math.max(1, parseInt(newValue, 10) || 10); break;
    }
    
    if (!this._connected) return;

    if (['post', 'uri', 'service'].includes(name)) {
      if (this._post || this._uri) {
        this.init();
      }
    } else {
      this.render();
    }
  }

  connectedCallback() {
    this._connected = true;

    if (this._post || this._uri) {
      this.init();
    }
  }

  disconnectedCallback() {
    this._connected = false;
    this._abortController?.abort();
    this._abortController = null;
  }

  private async init() {
    this._abortController?.abort();
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._loading = true;
    this._error = null;
    this.render();

    try {
      let finalUri = this._uri;

      if (!finalUri && this._post) {
        finalUri = await this.resolveUrlToUri(this._post, signal);
      }

      if (signal.aborted) return;

      if (finalUri) {
        await this.fetchThread(finalUri, signal);
      } else {
        this._data = null;
      }
    } catch (e) {
      if (signal.aborted) return;
      this._error = (e as Error).message;
    } finally {
      if (!signal.aborted) {
        this._loading = false;
        this.render();
      }
    }
  }

  private async resolveUrlToUri(url: string, signal: AbortSignal): Promise<string> {
    const match = url.match(/profile\/([^\/]+)\/post\/([^\/]+)/);
    if (!match) throw new Error('Invalid Bluesky URL');
    const [, handle, postId] = match;
    if (handle.startsWith('did:')) return `at://${handle}/app.bsky.feed.post/${postId}`;
    
    const res = await fetch(`${this._service}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, { signal });
    if (!res.ok) throw new Error('Could not resolve handle');
    const data = await res.json();
    if (!data.did) throw new Error('No DID found');
    
    return `at://${data.did}/app.bsky.feed.post/${postId}`;
  }

  private async fetchThread(uri: string, signal: AbortSignal) {
    const res = await fetch(`${this._service}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=${this._depth}`, { signal });
    if (!res.ok) throw new Error('Failed to fetch thread');
    const json = await res.json();
    if (json.thread?.$type === 'app.bsky.feed.defs#threadViewPost') {
      this._data = json.thread;
    } else {
      this._data = null; 
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  private renderRichText(record: BlueskyPost['record']): string {
    const { text, facets } = record;
    if (!facets || facets.length === 0) return this.escapeHtml(text);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(text);

    const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);

    let result = '';
    let lastEnd = 0;

    for (const facet of sorted) {
      const { byteStart, byteEnd } = facet.index;
      if (byteStart < lastEnd || byteEnd > bytes.length) continue;

      result += this.escapeHtml(decoder.decode(bytes.slice(lastEnd, byteStart)));

      const segment = this.escapeHtml(decoder.decode(bytes.slice(byteStart, byteEnd)));
      const feature = facet.features[0];

      if (!feature) {
        result += segment;
      } else if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
        result += `<a href="${this.escapeHtml(feature.uri)}" target="_blank" rel="noopener noreferrer">${segment}</a>`;
      } else if (feature.$type === 'app.bsky.richtext.facet#mention' && feature.did) {
        result += `<a href="https://bsky.app/profile/${encodeURIComponent(feature.did)}" target="_blank" rel="noopener noreferrer">${segment}</a>`;
      } else if (feature.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
        result += `<a href="https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}" target="_blank" rel="noopener noreferrer">${segment}</a>`;
      } else {
        result += segment;
      }

      lastEnd = byteEnd;
    }

    result += this.escapeHtml(decoder.decode(bytes.slice(lastEnd)));
    return result;
  }

  private formatDate(dateStr: string): string {
    return '· ' + new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private sortReplies(replies: BlueskyThreadNode[]): BlueskyThreadNode[] {
    return [...replies].sort((a, b) => {
      const timeA = new Date(a.post.indexedAt).getTime();
      const timeB = new Date(b.post.indexedAt).getTime();
      return this._sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }

  private renderComment(node: BlueskyThreadNode): string {
    if (!node.post) return '';
    const { post, replies } = node;
    const postId = post.uri.split('/').pop() || '';
    const postUrl = `https://bsky.app/profile/${encodeURIComponent(post.author.handle)}/post/${encodeURIComponent(postId)}`;

    const repliesHtml = (replies && replies.length > 0) 
      ? `<div class="bsky-replies">
           ${this.sortReplies(replies).map(r => this.renderComment(r)).join('')}
         </div>`
      : '';

    return `
      <div class="bsky-comment">
        <div class="bsky-comment-header">
          ${post.author.avatar 
            ? `<img src="${this.escapeHtml(post.author.avatar)}" alt="${this.escapeHtml(post.author.handle)}" class="bsky-avatar" loading="lazy" />` 
            : `<div class="bsky-avatar-placeholder"></div>`
          }
          <div class="bsky-meta">
            <a href="https://bsky.app/profile/${encodeURIComponent(post.author.handle)}" target="_blank" rel="noopener noreferrer" class="bsky-author">
              ${this.escapeHtml(post.author.displayName || post.author.handle)}
            </a>
            <span class="bsky-handle">@${this.escapeHtml(post.author.handle)}</span>
            <a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="bsky-date">
              ${this.formatDate(post.indexedAt)}
            </a>
          </div>
        </div>
        <div class="bsky-body"><p>${this.renderRichText(post.record)}</p></div>
        <div class="bsky-actions">
          <span class="bsky-like"><span class="bsky-icon bsky-icon-like">${this._iconLike}</span>${post.likeCount ?? 0}</span>
          <span class="bsky-reply"><span class="bsky-icon bsky-icon-reply">${this._iconReply}</span>${post.replyCount ?? 0}</span>
        </div>
        ${repliesHtml}
      </div>
    `;
  }

  private render() {
    if (this._loading) {
      this.innerHTML = `<div class="bsky-loading">Loading comments...</div>`;
      return;
    }
    if (this._error) {
      this.innerHTML = `<div class="bsky-error">Error: ${this.escapeHtml(this._error)}</div>`;
      return;
    }

    if (!this._uri && !this._post) {
      this.innerHTML = ``;
      return;
    }

    if (!this._data) {
      this.innerHTML = `
        <div class="bsky-empty">
          <p class="bsky-empty-text">No discussion found for this post.</p>
        </div>
      `;
      return;
    }

    const postUrl = `https://bsky.app/profile/${encodeURIComponent(this._data.post.author.handle)}/post/${encodeURIComponent(this._data.post.uri.split('/').pop() || '')}`;
    const sortedReplies = this._data.replies ? this.sortReplies(this._data.replies) : [];
    const commentsHtml = sortedReplies.map(r => this.renderComment(r)).join('') || '';
    
    this.innerHTML = `
      <div class="bsky-container">
        <div class="bsky-header">
            <span class="bsky-header-text">
                Discussion found on <a href="${postUrl}" target="_blank" rel="noopener noreferrer">Bluesky</a>
            </span>
            <a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="bsky-reply-btn">
                Reply to join discussion
            </a>
        </div>
        ${commentsHtml || '<div class="bsky-no-replies">No replies yet. Be the first to comment!</div>'}
      </div>
    `;
  }
}

if (!customElements.get('bsky-comments')) {
  customElements.define('bsky-comments', BskyComments);
}

export interface BskyCommentsAttributes {
  post?: string;
  uri?: string;
  sort?: 'asc' | 'desc';
  service?: string;
  'icon-like'?: string;
  'icon-reply'?: string;
  depth?: number | string;
  children?: unknown;
  class?: string;
  id?: string;
  style?: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'bsky-comments': BskyComments;
  }

  namespace JSX {
    interface IntrinsicElements {
      'bsky-comments': BskyCommentsAttributes;
    }
  }
}
