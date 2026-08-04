const { validateProductionEnvironment } = require("../src/services/production-preflight");

const result = validateProductionEnvironment(process.env);

if (result.ok) {
  console.log(`PREFLIGHT_OK environment=production payment=${result.config.payment.provider}`);
} else {
  const missing = result.missing.join(",") || "-";
  const invalid = result.invalid.join(",") || "-";
  console.error(`PREFLIGHT_FAILED missing=${missing} invalid=${invalid}`);
  process.exitCode = 1;
}
