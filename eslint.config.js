// eslint.config.js: the base ESLint flat config of the npm workspaces.
// `npm run lint` runs it on the whole repository: JavaScript and TypeScript
// everywhere, Vue single-file components in the web apps, Node globals in the
// servers and config files, browser globals in the UIs.
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // build output, generated code and the other stacks' folders
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/gen/**',
      '**/generated/**',
      'reports/**',
      'services/api/**',
      'services/propagator/**',
      'services/ros2-publisher/**',
      'services/store/**',
      '.agent-team/**',
      '.agents/**',
      '.claude/**',
      '.opencode/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    // the web UIs run in the browser
    files: ['services/*-web/src/**/*.{js,ts,vue}', 'packages/**/*.{js,ts}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // servers, scripts, tests and config files run on Node
    files: [
      'services/*-web/server/**/*.{js,ts}',
      'libs/**/*.{js,ts}',
      'e2e/**/*.{js,ts}',
      'scripts/**/*.{js,mjs,ts}',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
);
