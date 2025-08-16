module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js','!src/extension.js'],
  coverageThreshold: {
    // Raised after adding agent + apiKeyStore tests
    global: { lines: 80, statements: 70, functions: 65, branches: 55 }
  }
};
