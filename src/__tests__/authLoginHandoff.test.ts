/**
 * Regression: post-login SPA auth is split across two transports —
 * React Query ``["users"]`` (UI "am I logged in?") and the HttpOnly
 * ``Token`` cookie (API authorization). Login can succeed at the UI layer
 * while every subsequent REST call 401s when the cookie never lands.
 */
import middleware, {
    SESSION_COOKIE
} from "../../__json_server_mock__/middleware";

describe("auth login handoff (cookie vs React Query cache)", () => {
    it("documents the failure mode when login omits Set-Cookie", () => {
        const req = {
            body: { email: "alice@example.com", password: "pw" },
            headers: {},
            path: "/api/v1/auth/login"
        };
        const res = {
            end: jest.fn(),
            json: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn(function status(
                this: { statusCode: number },
                code: number
            ) {
                this.statusCode = code;
                return this;
            }),
            statusCode: 200
        };
        const next = jest.fn();

        // Simulate the pre-fix mock: login body succeeds but no cookie is issued.
        res.status.mockImplementation(function (
            this: { statusCode: number },
            code: number
        ) {
            this.statusCode = code;
            return this;
        });
        res.json.mockImplementation(() => res);
        res.status(200);
        res.json({
            _id: "alice@example.com",
            email: "alice@example.com",
            likedProjects: [],
            username: "alice"
        });

        // FE cache would show authenticated; API layer still rejects.
        const projectsReq = {
            body: {},
            headers: {},
            path: "/api/v1/projects"
        };
        const projectsRes = {
            end: jest.fn(),
            json: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn(function status(
                this: { statusCode: number },
                code: number
            ) {
                this.statusCode = code;
                return this;
            }),
            statusCode: 200
        };
        middleware(projectsReq, projectsRes, next);
        expect(projectsRes.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();

        // With the fixed middleware, login sets the cookie and projects pass through.
        const loginRes = {
            end: jest.fn(),
            json: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn(function status(
                this: { statusCode: number },
                code: number
            ) {
                this.statusCode = code;
                return this;
            }),
            statusCode: 200
        };
        const loginNext = jest.fn();
        middleware(req, loginRes, loginNext);
        expect(loginRes.setHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining(`${SESSION_COOKIE}=`)
        );

        const setCookie = loginRes.setHeader.mock.calls.find(
            ([name]) => name === "Set-Cookie"
        )?.[1] as string;
        const authedProjectsReq = {
            body: {},
            headers: { cookie: setCookie.split(";")[0] },
            path: "/api/v1/projects"
        };
        const authedNext = jest.fn();
        middleware(authedProjectsReq, projectsRes, authedNext);
        expect(authedNext).toHaveBeenCalledTimes(1);
    });
});
