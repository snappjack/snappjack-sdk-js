module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node', // Node environment for SDK components
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.test.ts'], // Match test files alongside source files
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/index*.ts', // Exclude entry point files
    '!src/client.ts', // Exclude entry point files
    '!src/server.ts', // Exclude entry point files
    '!src/core/types.ts', // Exclude types-only file
  ],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov', 'html'],
  // Enable fake timers globally for testing reconnection logic
  fakeTimers: {
    enableGlobally: true,
  },
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};