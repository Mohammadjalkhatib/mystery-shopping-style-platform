/**
 * Root Jest config.
 *
 * ESM, not CommonJS. That is forced on us: NestJS 12 ships no CommonJS entry point at all
 * ("type": "module", exports with a single ESM path), so the API is an ESM package and its
 * tests have to be too. See docs/DECISIONS.md D-007.
 *
 * Per CLAUDE.md section 5 there is no project for apps/web -- we do not test UI rendering.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // apps/web is included ONLY for the offline queue: CLAUDE.md section 5 rules out UI
  // rendering tests, but the queue is pure logic where a bug loses or duplicates evidence
  // silently. No component is rendered anywhere in this project.
  roots: [
    '<rootDir>/apps/api',
    '<rootDir>/packages/shared',
    '<rootDir>/apps/web/src/participant',
    // The i18n dictionary is data with an invariant that fails silently, not UI rendering.
    '<rootDir>/apps/web/src/i18n',
  ],
  testMatch: ['**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  // Maps our own `./foo.js` ESM imports back to `foo.ts` without touching node_modules.
  resolver: '<rootDir>/jest.resolver.cjs',
  moduleNameMapper: {
    '^@msp/shared$': '<rootDir>/packages/shared/src/index.ts',
  },
  transform: {
    '^.+\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  // Generous: the data-model suite boots a real MongoDB replica set via
  // mongodb-memory-server. Pure suites are unaffected -- this is a ceiling, not a delay.
  testTimeout: 120_000,
  clearMocks: true,
};
