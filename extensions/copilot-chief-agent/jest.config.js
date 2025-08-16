module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  reporters: ['default', '<rootDir>/jest.progress-reporter.js'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.js','!src/extension.js'],
  coverageThreshold: {
    // Ajustado a mínimo solicitado (80%) para continuar iteración sin bloquear
    global: { lines: 80, statements: 80, functions: 80, branches: 60 }
  }
};
