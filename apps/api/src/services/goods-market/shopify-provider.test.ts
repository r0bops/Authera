import { describe, expect, it, vi } from 'vitest';
import {
  ShopifyStorefrontProvider,
  matchProducts,
  type ShopifyProduct,
} from './shopify-provider.js';

const MERCHANT = '33333333-3333-4333-8333-333333333337';

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 1,
    title: "Men's Wool Runner",
    handle: 'mens-wool-runners',
    vendor: 'Allbirds',
    product_type: 'Shoes',
    tags: ['allbirds::gender => mens', 'wool'],
    variants: [
      { id: 11, title: '8', price: '110.00', available: false },
      { id: 12, title: '9', price: '110.00', available: true },
    ],
    images: [{ src: 'https://cdn.shopify.com/x.jpg' }],
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Shopify storefront matching', () => {
  it('requires every query token to appear in the title or type (tags are ignored)', () => {
    const catalog = [
      product(),
      product({ id: 2, title: 'Tree Dasher 2', handle: 'tree-dasher', tags: ['tree'] }),
      product({ id: 3, title: 'Wool Socks', handle: 'wool-socks', product_type: 'Socks' }),
    ];
    expect(matchProducts(catalog, 'wool runner').map((p) => p.id)).toEqual([1]);
    expect(matchProducts(catalog, 'WOOL').map((p) => p.id)).toEqual([1, 3]);
    expect(matchProducts(catalog, 'shoes').map((p) => p.id)).toEqual([1, 2]);
    expect(matchProducts(catalog, 'x')).toEqual([]);
    // a loose tag must not turn a different product into a match
    expect(matchProducts([product({ title: 'Loungers', tags: ['runner'] })], 'runner')).toEqual([]);
  });
});

describe('ShopifyStorefrontProvider', () => {
  it('reads the public catalog, keeps only available variants, and prices in minor units', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return json(200, {
        products: [
          product(),
          product({
            id: 2,
            title: "Women's Wool Runner",
            handle: 'womens-wool-runners',
            variants: [{ id: 21, title: '7', price: '98.50', available: true }],
          }),
          product({
            id: 3,
            title: 'Wool Runner Sold Out',
            handle: 'sold-out',
            variants: [{ id: 31, title: 'Default Title', price: '50.00', available: false }],
          }),
        ],
      });
    });
    const provider = new ShopifyStorefrontProvider({
      storeUrl: 'https://store.example/',
      merchantId: MERCHANT,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const offers = await provider.search({ q: 'wool runner' });

    expect(urls).toEqual(['https://store.example/products.json?limit=250']);
    expect(offers.map((o) => [o.providerOfferId, o.title, o.amountMinor])).toEqual([
      ['womens-wool-runners:21', "Women's Wool Runner — 7", 9_850],
      ['mens-wool-runners:12', "Men's Wool Runner — 9", 11_000],
    ]);
    expect(offers[0]).toMatchObject({ vendor: 'Allbirds', currency: 'USD', quantity: 1 });
  });

  it('revalidates one variant by handle and id (price already in minor units)', async () => {
    const responses = [
      json(200, { variants: [{ id: 12, price: 12_000, available: true }] }),
      json(200, { variants: [{ id: 12, price: 12_000, available: false }] }),
      json(404, {}),
    ];
    const provider = new ShopifyStorefrontProvider({
      storeUrl: 'https://store.example',
      merchantId: MERCHANT,
      fetch: (async () => responses.shift()!) as typeof fetch,
    });
    await expect(provider.revalidate('mens-wool-runners:12')).resolves.toMatchObject({
      available: true,
      amountMinor: 12_000,
    });
    await expect(provider.revalidate('mens-wool-runners:12')).resolves.toEqual({
      available: false,
    });
    await expect(provider.revalidate('mens-wool-runners:12')).resolves.toEqual({
      available: false,
    });
    await expect(provider.revalidate('garbage')).resolves.toEqual({ available: false });
  });
});
