import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { 
      ecmaVersion: 2022, 
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        fetch: true,
        AbortController: true
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tests/**/*.test.js','tests/__mocks__/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        // Jest globals
        describe: true,
        test: true,
        expect: true,
        jest: true,
        module: true
      }
    }
  }
];
