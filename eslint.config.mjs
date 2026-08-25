import nextConfig from 'eslint-config-next/core-web-vitals';

/**
 * ESLint flat config.
 *
 * Next.js 16 ships `eslint-config-next` as a native flat-config array, so the
 * legacy `FlatCompat` bridge is not used here — routing it through eslintrc's
 * compat layer makes the validator choke on the flat plugin objects it now
 * contains ("Converting circular structure to JSON").
 *
 * `eslint-config-next/core-web-vitals` expands to four configs:
 *   next                  plugins: react, react-hooks, import, jsx-a11y, @next/next
 *   next/typescript       plugins: @typescript-eslint   (scoped to **\/*.ts(x))
 *   ignores
 *   next/core-web-vitals
 *
 * Because the TypeScript plugin is file-scoped, the @typescript-eslint rules
 * below must be file-scoped too. Declaring them in an unscoped config object
 * makes ESLint apply them to .mjs files as well, where the plugin is not
 * registered, and it fails with "could not find plugin @typescript-eslint".
 */

const eslintConfig = [
  ...nextConfig,

  // Rules that hold for every lintable file.
  {
    rules: {
      // AI Core's premise is not lying about what happened, so a swallowed error
      // is a correctness bug, not a style issue.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // TypeScript-specific rules, scoped to where the plugin exists.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Global ignores: an object whose only key is `ignores` applies repo-wide.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      '.data/**',
      'tests/e2e/artifacts/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
];

export default eslintConfig;
