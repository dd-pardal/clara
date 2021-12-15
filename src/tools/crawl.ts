import { crawl } from "../starrpark.biz/crawler.js";
import { loadConfigsFromFileSync } from "../configs.js";
import { Database } from "../db.js";

const configsPath = process.argv[2] as string | undefined;
if (!configsPath) {
	console.error("ERROR: You must specify the configuration file’s path in the first argument.");
	process.exit(1);
}
const configs = loadConfigsFromFileSync(configsPath);

const db = new Database(configs.databasePath);

await crawl(configs.spb.requestOptions, new Map(db.getSPBPathInfos().map(i => [i.path, i])), db.setSPBPathInfo.bind(db));
console.log("Crawl done!");

db.close();
