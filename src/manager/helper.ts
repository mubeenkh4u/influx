import { injectShim, uninstallInflux } from "./installation";

async function run(): Promise<void> {
  const [action, resources, mainScript] = process.argv.slice(2);
  if (action === "--help") {
    console.log("Influx Manager privileged helper\nUsage: influx-manager-helper install <resources> <main.js> | uninstall <resources>");
    return;
  }
  if (typeof resources !== "string" || !resources)
    throw new Error("A Fluxer resources directory is required");
  if (action === "install") {
    if (typeof mainScript !== "string" || !mainScript)
      throw new Error("The Influx main.js path is required");
    await injectShim(resources, mainScript);
    console.log("Influx injection installed");
  } else if (action === "uninstall") {
    uninstallInflux(resources);
    console.log("Influx injection removed");
  } else {
    throw new Error("Unknown helper action");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
