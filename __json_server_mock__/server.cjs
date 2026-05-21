/**
 * Local REST mock aligned with the cookie-session FE contract.
 *
 * json-server v1 dropped the ``--middleware`` flag, so this small Node
 * server runs ``middleware.js`` in front of the seed ``db.json`` data
 * under the ``/api/v1/*`` prefix the Vite dev proxy expects.
 */
const http = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const middleware = require("./middleware.js");

const PORT = Number(process.env.MOCK_API_PORT || 8080);
const DB_PATH = join(__dirname, "db.json");
const db = JSON.parse(readFileSync(DB_PATH, "utf8"));

const sendJson = (res, status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
};

const readBody = (req) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });

const collectionForPath = (pathname) => {
    const segments = pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
    const name = segments[0];
    if (!name || !(name in db)) {
        return null;
    }
    return { name, records: db[name] };
};

const handleResource = (req, res, pathname) => {
    const collection = collectionForPath(pathname);
    if (!collection) {
        sendJson(res, 404, { error: "Not Found" });
        return;
    }
    if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
    }
    sendJson(res, 200, collection.records);
};

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type, authorization"
    );
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    let body = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
        try {
            body = await readBody(req);
        } catch {
            sendJson(res, 400, { error: "Invalid JSON body" });
            return;
        }
    }

    const bridgeReq = {
        body,
        headers: req.headers,
        method: req.method,
        path: pathname
    };
    const bridgeRes = {
        end: (payload) => {
            if (payload !== undefined && payload !== null) {
                res.end(payload);
            } else {
                res.end();
            }
        },
        json: (payload) => sendJson(res, bridgeRes.statusCode || 200, payload),
        setHeader: (name, value) => {
            res.setHeader(name, value);
        },
        status: (code) => {
            bridgeRes.statusCode = code;
            res.statusCode = code;
            return bridgeRes;
        },
        statusCode: 200
    };

    await new Promise((resolve) => {
        middleware(bridgeReq, bridgeRes, () => {
            handleResource(req, res, pathname);
            resolve(undefined);
        });
    });
});

server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
        `Mock API (cookie auth) listening on http://localhost:${PORT}/api/v1`
    );
});
