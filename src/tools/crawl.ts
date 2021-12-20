import { crawl } from "../starrpark.biz/crawler.js";
import { loadConfigsFromFileSync } from "../configs.js";
import { Database } from "../db.js";
import { formatDateTimeAsISO8601Basic } from "../util/format-time.js";

const configsPath = process.argv[2] as string | undefined;
if (!configsPath) {
	console.error("ERROR: You must specify the configuration file’s path in the first argument.");
	process.exit(1);
}
const configs = loadConfigsFromFileSync(configsPath);

const db = new Database(configs.databasePath);

const directoryName = formatDateTimeAsISO8601Basic(new Date());
await crawl({
	requestOptions: configs.spb.requestOptions,
	archiveOptions: configs.spb.archive.enabled ? {
		basePath: configs.spb.archive.basePath,
		directoryName,
		prevDirectoryName: db.getValue("spb.archiveDirectoryName") as string | null
	} : undefined,
	pathInfoMap: new Map(db.getSPBPathInfos().map(i => [i.path, i])),
	setPathInfo: db.setSPBPathInfo.bind(db)
});
db.setValue("spb.archiveDirectoryName", directoryName);
console.log("Crawl done!");

db.close();
