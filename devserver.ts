import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { execSync } from "node:child_process";
import http from "node:http";
import chalk from "chalk";
import { createServer } from "vite";
import { WebSocketServer } from "ws";

// Monkey-patch WebSocketServer handleUpgrade to intercept upgraded WebSockets
// and attach an error handler to prevent crashing the server on client network errors/frame issues
const originalHandleUpgrade = WebSocketServer.prototype.handleUpgrade;
WebSocketServer.prototype.handleUpgrade = function (this: any, request: any, socket: any, head: any, callback: any) {
	return originalHandleUpgrade.call(this, request, socket, head, (ws: any, ...args: any[]) => {
		ws.on("error", (err: any) => {
			console.error("Multiplexed upgraded WebSocket connection error:", err);
		});
		return callback(ws, ...args);
	});
};

//@ts-expect-error no typedefs
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import {
	normalizeWebsocketUrl,
	warnOnUrlEscape,
	runRspack,
	black,
	printBanner
} from "./devlib.ts";
import rspackConfig from "./rspack.config.ts";

const image = await fs.readFile("./assets/scramjet-mini-noalpha.png");

let commit = "unknown";
let branch = "unknown";
try {
	commit = execSync("git rev-parse --short HEAD", {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	}).replace(/\r?\n|\r/g, "");
} catch (e) {}

try {
	branch = execSync("git rev-parse --abbrev-ref HEAD", {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	}).replace(/\r?\n|\r/g, "");
} catch (e) {}
const packagejson = JSON.parse(await fs.readFile("./package.json", "utf-8"));
const version = packagejson.version;

const DEMO_PORT = 3000;
const WISP_PORT = process.env.WISP_PORT || 4142;

if (process.env.VITE_WISP_URL) {
	process.env.VITE_WISP_URL = normalizeWebsocketUrl(process.env.VITE_WISP_URL);
} else {
	process.env.VITE_WISP_URL = `ws://localhost:${DEMO_PORT}/`;
}

const wispserver = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("wisp server js rewrite");
});
wisp.options.allow_private_ips = true;
wisp.options.allow_loopback_ips = true;

wispserver.on("upgrade", (req, socket, head) => {
	socket.on("error", (err) => {
		console.error("Wispserver upgrade socket error:", err);
	});
	try {
		wisp.routeRequest(req, socket, head);
	} catch (err) {
		console.error("Wispserver routeRequest error:", err);
		socket.destroy();
	}
});

wispserver.listen(Number(WISP_PORT));

const server = await createServer({
	configFile: "./packages/demo/vite.config.ts",
	root: "./packages/demo",
	server: {
		port: Number(DEMO_PORT),
		strictPort: true,
		host: "0.0.0.0",
	},
});

warnOnUrlEscape(server);

await server.listen();

// Multiplex Wisp WebSocket connection and Vite HMR safely on the main Vite HTTP server
const originalUpgradeListeners = server.httpServer?.listeners("upgrade") || [];
for (const listener of originalUpgradeListeners) {
	server.httpServer?.off("upgrade", listener as any);
}

server.httpServer?.on("upgrade", (req, socket, head) => {
	socket.on("error", (err) => {
		console.error("Multiplexed upgrade socket error:", err);
	});

	const isViteHmr = req.headers["sec-websocket-protocol"] === "vite-hmr";
	if (isViteHmr) {
		for (const listener of originalUpgradeListeners) {
			(listener as any).call(server.httpServer, req, socket, head);
		}
	} else {
		try {
			wisp.routeRequest(req, socket, head);
		} catch (err) {
			console.error("Multiplexed wisp routeRequest error:", err);
			socket.destroy();
		}
	}
});

const accent = (text: string) => chalk.hex("#f1855bff").bold(text);
const highlight = (text: string) => chalk.hex("#fdd76cff").bold(text);
const urlColor = (text: string) => chalk.hex("#64DFDF").underline(text);
const note = (text: string) => chalk.hex("#CDB4DB")(text);
const connector = chalk.hex("#8D99AE").dim("@");

const lines = [
	black()(`${highlight("SCRAMJET DEV SERVER")}`),
	black()(
		`${accent("demo")} ${connector} ${urlColor(
			`http://localhost:${DEMO_PORT}/`
		)}`
	),
	black()(
		`${accent("wisp")} ${connector} ${urlColor(
			process.env.VITE_WISP_URL ?? ""
		)}`
	),
	black()(chalk.dim(`[${branch}] ${commit} scramjet/${version}`)),
];

runRspack(rspackConfig);

printBanner(image, lines);
