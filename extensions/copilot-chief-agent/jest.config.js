module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js','!src/extension.js'],
  coverageThreshold: {
    global: { lines: 40, statements: 40, functions: 30, branches: 20 }
  }
};
