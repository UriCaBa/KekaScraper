import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Global ignores
  {
    ignores: ['node_modules/**', 'release/**', 'output/**'],
  },

  // Base: recommended rules for all JS files
  js.configs.recommended,

  // Node.js ESM files
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs'],
    ignores: ['src/ui/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.nodeBuiltin,
      },
    },
  },

  // Browser files (Electron renderer / UI)
  {
    files: ['src/ui/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },

  // CommonJS files (Electron preload)
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.nodeBuiltin,
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
  },

  // Smoke test scripts — use document/window inside Playwright page.evaluate() callbacks
  {
    files: ['scripts/smoke-*.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Test files — relaxed no-unused-vars for _prefixed args
  {
    files: ['test/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Disable Prettier-conflicting rules (must be last)
  prettierConfig,
];
