import { consolidateMiguelitoDatabases } from "../src/infrastructure/consolidateDb.js";

async function main() {
  const dataDir = process.argv[2] ?? process.env.DATA_DIR ?? "./data";
  const targetPath = process.argv[3];
  const result = await consolidateMiguelitoDatabases({ dataDir, targetPath });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
