/**
 * @fileoverview Allows executing DB commands.
 */

import { start as startREPL } from "repl";

import { loadConfigsFromFileSync } from "../configs.js";
import { Database } from "../db.js";

const configsPath = process.argv[2] as string | undefined;
if (!configsPath) {
	console.error("ERROR: You must specify the configuration file’s path in the first argument.");
	process.exit(1);
}
const configs = loadConfigsFromFileSync(configsPath);

const db = new Database(configs.databasePath);

console.log("`db`: database object");

const repl = startREPL();
Object.assign(repl.context, {
	db
});

repl.on("exit", () => {
	db.close();
});
