module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js','!src/extension.js'],
  coverageThreshold: {
    // Raised after adding initial tests (scanner + memory manager + parsers)
    global: { lines: 30, statements: 30, functions: 20, branches: 20 }
  }
};
