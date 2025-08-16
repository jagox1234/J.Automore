module.exports = {
  workspace: { getConfiguration: () => ({ get: () => 'gpt-test' }) },
  window: { showWarningMessage: jest.fn(), showErrorMessage: jest.fn() }
};
