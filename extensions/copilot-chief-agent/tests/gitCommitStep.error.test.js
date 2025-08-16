jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: () => 5 }) } }));
const cp = require('child_process');
const { gitCommitStep } = require('../src/agent');

test('gitCommitStep rejects on error', async () => {
  jest.spyOn(cp, 'exec').mockImplementation((cmd, opts, cb) => cb(new Error('fail'), '', 'fail'));
  await expect(gitCommitStep('Paso malo')).rejects.toThrow('fail');
});
