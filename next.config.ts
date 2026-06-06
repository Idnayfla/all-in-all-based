import type { NextConfig } from 'next';
import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
    ],
  },
  transpilePackages: [
    'react-markdown',
    '@ungap/structured-clone',
    'bail',
    'ccount',
    'character-entities',
    'character-entities-html4',
    'character-entities-legacy',
    'character-reference-invalid',
    'comma-separated-tokens',
    'decode-named-character-reference',
    'devlop',
    'estree-util-is-identifier-name',
    'hast-util-to-jsx-runtime',
    'hast-util-whitespace',
    'html-url-attributes',
    'is-alphabetical',
    'is-alphanumerical',
    'is-decimal',
    'is-hexadecimal',
    'is-plain-obj',
    'longest-streak',
    'mdast-util-from-markdown',
    'mdast-util-mdx-expression',
    'mdast-util-mdx-jsx',
    'mdast-util-mdxjs-esm',
    'mdast-util-phrasing',
    'mdast-util-to-hast',
    'mdast-util-to-markdown',
    'mdast-util-to-string',
    'micromark',
    'micromark-core-commonmark',
    'micromark-factory-destination',
    'micromark-factory-label',
    'micromark-factory-space',
    'micromark-factory-title',
    'micromark-factory-whitespace',
    'micromark-util-character',
    'micromark-util-chunked',
    'micromark-util-classify-character',
    'micromark-util-combine-extensions',
    'micromark-util-decode-numeric-character-reference',
    'micromark-util-decode-string',
    'micromark-util-encode',
    'micromark-util-html-tag-name',
    'micromark-util-normalize-identifier',
    'micromark-util-resolve-all',
    'micromark-util-sanitize-uri',
    'micromark-util-subtokenize',
    'micromark-util-symbol',
    'micromark-util-types',
    'parse-entities',
    'property-information',
    'remark-parse',
    'remark-rehype',
    'space-separated-tokens',
    'stringify-entities',
    'trim-lines',
    'trough',
    'unified',
    'unist-util-is',
    'unist-util-position',
    'unist-util-stringify-position',
    'unist-util-visit',
    'unist-util-visit-parents',
    'vfile',
    'vfile-message',
    'zwitch',
  ],
  async headers() {
    return [
      // ── Static asset caching ──────────────────────────────────
      {
        // Images, fonts, icons — content-hashed by Next.js, safe to cache forever
        source: '/:path*\\.(webp|png|jpg|jpeg|svg|ico|woff2|woff|ttf|otf)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // 3D models — large, infrequently changed
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Video backgrounds — may change; 1-week cache with revalidation
        source: '/videos/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
      // ── Security headers (all routes) ────────────────────────
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self' blob: data:; media-src 'self' blob: https:; worker-src 'self' blob:;",
          },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      'framer-motion': 'framer-motion/dist/cjs/index.js',
    },
  },
  webpack: config => {
    config.resolve.alias['framer-motion'] = path.resolve(
      './node_modules/framer-motion/dist/cjs/index.js'
    );
    return config;
  },
};

// Sentry's Turbopack plugin wraps route handlers with AbortSignal instrumentation
// that fires during Turbopack's module compilation, surfacing as "Runtime AbortError"
// in the dev overlay. Skip the wrapper entirely in dev — Sentry is already disabled
// at runtime via `enabled: process.env.NODE_ENV === 'production'` in sentry.client.config.ts.
const sentryOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: { disable: true },
  disableLogger: true,
  automaticVercelMonitors: false,
};

export default process.env.NODE_ENV === 'production'
  ? withSentryConfig(nextConfig, sentryOptions)
  : nextConfig;
