export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleNameMapper: {
    '^@drag/(.*)$': '<rootDir>/src/$1',
    '^@dayflow/core$': '<rootDir>/../../core/src/index.ts',
    '^@dayflow/ui-range-picker$':
      '<rootDir>/../../ui/range-picker/src/index.ts',
    '^@dayflow/ui-context-menu$':
      '<rootDir>/../../ui/context-menu/src/index.ts',
    '^@ui-range-picker/(.*)$': '<rootDir>/../../ui/range-picker/src/$1',
    '^@/(.*)$': '<rootDir>/../../core/src/$1',
    '^preact$': '<rootDir>/../../../node_modules/preact/dist/preact.js',
    '^preact/hooks$':
      '<rootDir>/../../../node_modules/preact/hooks/dist/hooks.js',
    '^preact/jsx-runtime$':
      '<rootDir>/../../../node_modules/preact/jsx-runtime/dist/jsxRuntime.js',
    '^preact/compat$':
      '<rootDir>/../../../node_modules/preact/compat/dist/compat.js',
  },
};
