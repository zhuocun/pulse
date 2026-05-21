import middleware, {
    SESSION_COOKIE,
    parseCookies,
    sessionTokenFromRequest
} from "../../__json_server_mock__/middleware";

type MockRequest = {
    body: Record<string, string>;
    headers: Record<string, string | undefined>;
    path: string;
};

type MockResponse = {
    end: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    status: jest.Mock;
    statusCode: number;
};

const createRequest = (overrides: Partial<MockRequest> = {}): MockRequest => ({
    body: {},
    headers: {},
    path: "/projects",
    ...overrides
});

const createResponse = (): MockResponse => {
    const response = {
        statusCode: 200
    } as MockResponse;

    response.status = jest.fn((code: number) => {
        response.statusCode = code;
        return response;
    });
    response.json = jest.fn((_body?: unknown) => response);
    response.setHeader = jest.fn();
    response.end = jest.fn(() => response);

    return response;
};

const runMiddleware = (request: Partial<MockRequest>) => {
    const req = createRequest(request);
    const res = createResponse();
    const next = jest.fn();

    middleware(req, res, next);

    return { next, req, res };
};

describe("json-server middleware", () => {
    it.each(["/login", "/api/v1/auth/login"])(
        "returns a login user and sets the HttpOnly session cookie for %s",
        (path) => {
            const { next, res } = runMiddleware({
                body: { email: "alice@example.com", password: "pw" },
                path
            });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                _id: "alice@example.com",
                email: "alice@example.com",
                likedProjects: [],
                username: "alice"
            });
            expect(res.setHeader).toHaveBeenCalledWith(
                "Set-Cookie",
                expect.stringContaining(`${SESSION_COOKIE}=alice%40example.com`)
            );
            expect(res.setHeader).toHaveBeenCalledWith(
                "Set-Cookie",
                expect.stringMatching(/HttpOnly/i)
            );
            expect(next).not.toHaveBeenCalled();
        }
    );

    it("rejects invalid login credentials", () => {
        const { next, res } = runMiddleware({
            body: { email: "wrong@example.com", password: "pw" },
            path: "/login"
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: "Invalid credential, please try again"
        });
        expect(next).not.toHaveBeenCalled();
    });

    it("rejects login requests with a missing password", () => {
        const { next, res } = runMiddleware({
            body: { email: "alice@example.com" },
            path: "/login"
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: "Invalid credential, please try again"
        });
        expect(next).not.toHaveBeenCalled();
    });

    it.each(["/register", "/api/v1/auth/register"])(
        "creates users from valid register requests for %s",
        (path) => {
            const { next, res } = runMiddleware({
                body: { email: "alice@example.com", password: "pw" },
                path
            });

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ message: "User created" });
            expect(next).not.toHaveBeenCalled();
        }
    );

    it.each([
        [{ email: "wrong@example.com", password: "pw" }, "wrong email"],
        [{ email: "alice@example.com" }, "missing password"]
    ])("rejects invalid register requests for %s", (body, _label) => {
        const { next, res } = runMiddleware({
            body,
            path: "/register"
        });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: "Register failed, please try again"
        });
        expect(next).not.toHaveBeenCalled();
    });

    it("clears the session cookie on logout", () => {
        const { next, res } = runMiddleware({
            path: "/api/v1/auth/logout"
        });

        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.setHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringMatching(/Max-Age=0/i)
        );
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it("rejects non-auth routes without a session cookie or bearer token", () => {
        const { next, res } = runMiddleware({ path: "/projects" });

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
        expect(next).not.toHaveBeenCalled();
    });

    it.each(["/userInfo", "/api/v1/users"])(
        "returns user info from the HttpOnly session cookie for %s",
        (path) => {
            const { next, res } = runMiddleware({
                headers: {
                    cookie: `${SESSION_COOKIE}=alice%40example.com`
                },
                path
            });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                _id: "alice@example.com",
                email: "alice@example.com",
                likedProjects: [],
                username: "alice"
            });
            expect(next).not.toHaveBeenCalled();
        }
    );

    it.each(["/userInfo", "/api/v1/users"])(
        "still accepts bearer authorization for non-browser callers on %s",
        (path) => {
            const { next, res } = runMiddleware({
                headers: { authorization: "Bearer alice@example.com" },
                path
            });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                _id: "alice@example.com",
                email: "alice@example.com",
                likedProjects: [],
                username: "alice"
            });
            expect(next).not.toHaveBeenCalled();
        }
    );

    it("passes authorized non-special routes through", () => {
        const { next, res } = runMiddleware({
            headers: { cookie: `${SESSION_COOKIE}=token-1` },
            path: "/projects"
        });

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it("parses cookie headers for session lookup helpers", () => {
        expect(
            parseCookies(`${SESSION_COOKIE}=alice%40example.com; other=1`)
        ).toEqual({
            [SESSION_COOKIE]: "alice@example.com",
            other: "1"
        });
        expect(
            sessionTokenFromRequest({
                headers: { cookie: `${SESSION_COOKIE}=alice%40example.com` }
            })
        ).toBe("alice@example.com");
    });
});
