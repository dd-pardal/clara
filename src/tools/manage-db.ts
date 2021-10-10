/**
 * @fileoverview Allows to reconfigure the bot and to execute DB commands.
 */

import { start as startREPL } from "repl";

import { Database } from "../db.js";

const db = new Database("./db.sqlite");

console.log("`db`: database object\n`c`: config object");

const repl = startREPL();
Object.assign(repl.context, {
	db,
	c: db.configs
});

repl.on("exit", () => {
	db.updateConfigs();
	db.close();
});
