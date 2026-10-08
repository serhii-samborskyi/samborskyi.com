import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Native anchors intentionally reset the independent listening/studio surfaces.
  // Media URLs include private authenticated drafts; native images preserve that flow.
  { rules: { '@next/next/no-html-link-for-pages': 'off', '@next/next/no-img-element': 'off' } },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
