import { runCli } from "../src/cli.js";

runCli(process.argv).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nFatal: ${msg}\n`);
  process.exit(1);
});
