import { crawl } from "../starrpark.biz/crawler.js";
import { Database } from "../db.js";

const db = new Database("./db.sqlite");

await crawl(db.configs.spb.requestOptions, new Map(db.getSPBPathInfos().map(i => [i.path, i])), db.setSPBPathInfo.bind(db));
console.log("Crawl done!");

db.close();
