import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-renderer/**',
      '**/dist-electron/**',
      '**/build/**',
      '**/node_modules/**',
      'vendor/**',
      'scratch/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.cjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript performs its own undefined-symbol analysis, so the core
      // no-undef rule produces false positives for DOM/Node globals.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off'
    }
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Node-run build/setup scripts: enable Node globals so process/console are
    // recognised instead of flagged as undefined.
    files: ['scripts/**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly'
      }
    }
  },
  prettier
);
