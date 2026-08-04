#!/usr/bin/env node

const { runDeploymentSmoke } = require("../src/services/deployment-smoke");

async function main({
  argv = process.argv.slice(2),
  runSmoke = runDeploymentSmoke,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const args = argv;
  if (args.length !== 1) {
    stderr("Usage: npm run smoke -- https://your-miniapp-domain.example");
    return 1;
  }

  try {
    const result = await runSmoke({ baseUrl: args[0] });
    for (const check of result.checks) {
      stdout(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    }
    return result.ok ? 0 : 1;
  } catch {
    stderr("Deployment smoke could not run.");
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { main };
