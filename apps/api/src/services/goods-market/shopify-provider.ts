import type { Currency, ProductSearchQuery } from '@authera/contracts';
import { withOneRetry } from '../flight-market/duffel-provider.js';

/** A product variant as returned by a public Shopify storefront, before it is stored. */
export interface MarketProduct {
  /** `${handle}:${variantId}` — enough to re-price the exact variant later. */
  providerOfferId: string;
  title: string;
  vendor: string;
  imageUrl?: string;
  amountMinor: number;
  currency: Currency;
  quantity: number;
  expiresAt: Date;
}

export interface RevalidatedProduct {
  available: boolean;
  amountMinor?: number;
  currency?: Currency;
  expiresAt?: Date;
}

/** External goods market behind one Authera merchant. Discovery only; prices are stored first. */
export interface GoodsMarketProvider {
  readonly source: 'shopify';
  readonly merchantId: string;
  search(query: ProductSearchQuery, options?: { signal?: AbortSignal }): Promise<MarketProduct[]>;
  revalidate(
    providerOfferId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RevalidatedProduct>;
}

export interface ShopifyProviderOptions {
  /** Public storefront origin, e.g. https://www.allbirds.com */
  storeUrl: string;
  merchantId: string;
  /** Currency the storefront publishes prices in. */
  currency?: Currency;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long a discovered price is trusted before it must be re-read. */
  offerTtlMs?: number;
  /** Catalog page size (Shopify caps at 250). */
  catalogLimit?: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: Array<{ id: number; title: string; price: string; available: boolean; sku?: string }>;
  images: Array<{ src: string }>;
}

/**
 * Public Shopify storefront (`/products.json`, `/products/<handle>.js`): real catalog, real
 * prices, no credentials. Search is a deterministic token match over title/type/tags done
 * server-side; the LLM never sees the raw catalog.
 */
export class ShopifyStorefrontProvider implements GoodsMarketProvider {
  readonly source = 'shopify' as const;
  readonly merchantId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly offerTtlMs: number;
  private readonly catalogLimit: number;
  private readonly currency: Currency;

  constructor(private readonly options: ShopifyProviderOptions) {
    this.merchantId = options.merchantId;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.offerTtlMs = options.offerTtlMs ?? 2 * 60 * 60 * 1000;
    this.catalogLimit = options.catalogLimit ?? 250;
    this.currency = options.currency ?? 'USD';
  }

  async search(
    query: ProductSearchQuery,
    options: { signal?: AbortSignal } = {},
  ): Promise<MarketProduct[]> {
    const response = await this.request(
      `/products.json?limit=${this.catalogLimit}`,
      options.signal,
    );
    if (!response.ok) throw new Error(`Shopify catalog failed with HTTP ${response.status}`);
    const body = (await response.json()) as { products: ShopifyProduct[] };
    const now = Date.now();
    const limit = query.limit ?? 20;
    return matchProducts(body.products, query.q)
      .flatMap((product) => {
        const variant = product.variants.find((v) => v.available) ?? product.variants[0];
        if (!variant || !variant.available) return [];
        const amount = Number.parseFloat(variant.price);
        if (!Number.isFinite(amount) || amount < 0) return [];
        const title =
          variant.title && variant.title !== 'Default Title'
            ? `${product.title} — ${variant.title}`
            : product.title;
        const image = product.images[0]?.src;
        return [
          {
            providerOfferId: `${product.handle}:${variant.id}`,
            title,
            vendor: product.vendor,
            ...(image ? { imageUrl: image } : {}),
            amountMinor: Math.round(amount * 100),
            currency: this.currency,
            quantity: 1,
            expiresAt: new Date(now + this.offerTtlMs),
          } satisfies MarketProduct,
        ];
      })
      .sort((a, b) => a.amountMinor - b.amountMinor || a.title.localeCompare(b.title))
      .slice(0, limit);
  }

  async revalidate(
    providerOfferId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<RevalidatedProduct> {
    const [handle, variantId] = providerOfferId.split(':');
    if (!handle || !variantId) return { available: false };
    const response = await withOneRetry(() =>
      this.request(`/products/${encodeURIComponent(handle)}.js`, options.signal),
    );
    if (response.status >= 400 && response.status < 500 && response.status !== 429)
      return { available: false };
    if (!response.ok) throw new Error(`Shopify product lookup failed with HTTP ${response.status}`);
    // The .js endpoint returns prices in minor units already.
    const body = (await response.json()) as {
      variants: Array<{ id: number; price: number; available: boolean }>;
    };
    const variant = body.variants.find((v) => String(v.id) === variantId);
    if (!variant || !variant.available) return { available: false };
    return {
      available: true,
      amountMinor: Math.round(variant.price),
      currency: this.currency,
      expiresAt: new Date(Date.now() + this.offerTtlMs),
    };
  }

  private request(path: string, signal: AbortSignal | undefined): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return this.fetchImpl(`${this.options.storeUrl.replace(/\/$/, '')}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Authera/1.0 (+mandate gateway)' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }
}

/**
 * Every query token must appear in the product's title or type (case-insensitive). Tags are
 * deliberately ignored: stores tag loosely, and a "runner" tag on loungers is not a runner.
 */
export function matchProducts(products: ShopifyProduct[], query: string): ShopifyProduct[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  return products.filter((product) => {
    const haystack = [product.title, product.product_type].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
