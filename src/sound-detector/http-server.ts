/**
 * @fileoverview Provides a simple (and UNSAFE) static HTTP server for the sound detector.
 */

import * as http from "http";
import * as fs from "fs";

export { Server } from "http";

// IMPORTANT:
// This is a very unsafe implementation of a static HTTP server. An attacker that connects to it
// might be able to read ANY FILE the process has access to on your machine. By default, the
// port is only accessible to the local host, but this can still be a problem. Read
// <https://owasp.org/www-community/attacks/Server_Side_Request_Forgery> for more information.

export function serveFiles(): http.Server {
	const server = http.createServer(async (req, res) => {
		if (req.url !== undefined) {
			if (req.method === "GET") {
				if (req.url === "/") {
					res.statusCode = 301;
					res.statusMessage = "Moved Permanently";
					res.setHeader("Location", "/index.html");
					res.end();
				} else {
					let url;
					{
						const index = req.url.indexOf("?");
						url = index !== -1 ? req.url.slice(0, index) : req.url;
					}
					const stream = fs.createReadStream("./web" + url);
					stream.pipe(res, { end: true });
					stream.on("error", (err) => {
						// @ts-ignore
						if (err.code === "ENOENT") {
							res.statusCode = 404;
							res.statusMessage = "Not Found";
							res.end();
						} else {
							console.error(err);
							res.statusCode = 500;
							res.statusMessage = "Internal Server Error";
							res.end();
						}
					});
				}
			}
		}
	});

	server.listen(29110, "127.0.0.1");

	return server;
}
