const isPath = (req, ...paths) => paths.includes(req.path);

const SESSION_COOKIE = "Token";

const parseCookies = (header) => {
    if (!header || typeof header !== "string") {
        return {};
    }
    return Object.fromEntries(
        header.split(";").map((part) => {
            const trimmed = part.trim();
            const eq = trimmed.indexOf("=");
            if (eq === -1) {
                return [trimmed, ""];
            }
            return [
                trimmed.slice(0, eq),
                decodeURIComponent(trimmed.slice(eq + 1))
            ];
        })
    );
};

const sessionTokenFromRequest = (req) => {
    const authorization = req.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        const bearer = authorization.slice(7).trim();
        if (bearer) {
            return bearer;
        }
    }
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE];
    return typeof cookieToken === "string" ? cookieToken.trim() : "";
};

const setSessionCookie = (res, token) => {
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
    );
};

const clearSessionCookie = (res) => {
    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
};

const userFromEmail = (email) => ({
    _id: email,
    email,
    likedProjects: [],
    username: email.split("@")[0]
});

module.exports = (req, res, next) => {
    if (isPath(req, "/login", "/api/v1/auth/login")) {
        if (req.body.email && req.body.password) {
            if (req.body.email.includes("wrong")) {
                return res
                    .status(400)
                    .json({ error: "Invalid credential, please try again" });
            }
            const token = req.body.email;
            setSessionCookie(res, token);
            return res.status(200).json(userFromEmail(req.body.email));
        }
        return res
            .status(400)
            .json({ error: "Invalid credential, please try again" });
    }
    if (isPath(req, "/register", "/api/v1/auth/register")) {
        if (req.body.email && req.body.password) {
            if (req.body.email.includes("wrong")) {
                return res
                    .status(400)
                    .json({ error: "Register failed, please try again" });
            }
            return res.status(201).json({
                message: "User created"
            });
        }
        return res
            .status(400)
            .json({ error: "Register failed, please try again" });
    }
    if (isPath(req, "/auth/logout", "/api/v1/auth/logout")) {
        clearSessionCookie(res);
        return res.status(204).end();
    }
    const token = sessionTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (isPath(req, "/userInfo", "/api/v1/users", "/api/v1/users/")) {
        return res.status(200).json(userFromEmail(token));
    }
    return next();
};

module.exports.SESSION_COOKIE = SESSION_COOKIE;
module.exports.parseCookies = parseCookies;
module.exports.sessionTokenFromRequest = sessionTokenFromRequest;
