import { runCli } from './cli-main.js';

runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
