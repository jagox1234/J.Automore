const os = require('os');

function validateEnv(apiKey) {
  const warnings = [];
  if (!apiKey) warnings.push('OpenAI API key not set. Use command: Copilot Chief: Set API Key');
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) warnings.push('Proxy variables detected; requests may route through proxy.');
  if (os.totalmem() < 4 * 1024 * 1024 * 1024) warnings.push('System memory <4GB; large project scans may be slow.');
  const major = parseInt(process.version.slice(1).split('.')[0],10);
  if (major < 18) warnings.push(`Node version ${process.version} may lack optimal fetch performance; recommend >=18.`);
  return warnings;
}

module.exports = { validateEnv };
