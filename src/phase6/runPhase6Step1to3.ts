/**
 * CLI Entrypoint: Execute Phase 6 Steps 1-3 Development Benchmark ONLY.
 * Does NOT run Step 4 (Chain B confirmatory test) and NEVER accesses protected/external datasets.
 */
import { runPhase6Step1to3Benchmark } from './phase6Benchmark';

async function main() {
  const report = await runPhase6Step1to3Benchmark({ includeChainC: true });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
