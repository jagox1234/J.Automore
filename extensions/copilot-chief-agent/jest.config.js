module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js','!src/extension.js'],
  coverageThreshold: {
    // Raised after broader test suite (openai client, step manager, directory helper)
    global: { lines: 50, statements: 50, functions: 40, branches: 35 }
  }
};
