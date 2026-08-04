#!/usr/bin/env node

const { runDeploymentSmoke } = require("../src/services/deployment-smoke");

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: npm run smoke -- https://your-miniapp-domain.example");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runDeploymentSmoke({ baseUrl: args[0] });
    for (const check of result.checks) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.error("Deployment smoke could not run.");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
