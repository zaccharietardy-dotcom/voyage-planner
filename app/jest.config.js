/** @type {import('jest').Config} */
module.exports = {
  projects: [
    // Backend tests (services, utilities)
    {
      displayName: 'node',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: [
        '<rootDir>/src/lib/__tests__/**/*.test.ts',
        '<rootDir>/src/lib/pipeline/__tests__/**/*.test.ts',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: {
            module: 'commonjs',
            moduleResolution: 'node',
            esModuleInterop: true,
            strict: true,
            skipLibCheck: true,
          },
        }],
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    },
    // React component tests
    {
      displayName: 'react',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/components/**/*.test.tsx', '<rootDir>/src/hooks/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: {
            module: 'commonjs',
            moduleResolution: 'node',
            esModuleInterop: true,
            strict: true,
            skipLibCheck: true,
            jsx: 'react-jsx',
          },
        }],
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    },
  ],
};
