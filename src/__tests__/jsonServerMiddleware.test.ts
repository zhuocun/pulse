import middleware, {
    SESSION_COOKIE
} from "../../__json_server_mock__/middleware";

type MockRequest = {
    body: Record<string, string>;
    headers: Record<string, string | undefined>;
    path: string;
};

const createResponse = () => {
    const response = {
        statusCode: 200,
        end: jest.fn(),
        json: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn()
    };
    response.status.mockImplementation((code: number) => {
        response.statusCode = code;
        return response;
    });
    response.json.mockImplementation(() => response);
    response.end.mockImplementation(() => response);
    return response;
};

const runMiddleware = (request: Partial<MockRequest>) => {
    const req: MockRequest = {
        body: {},
        headers: {},
        path: "/projects",
        ...request
    };
    const res = createResponse();
    const next = jest.fn();
    middleware(req, res, next);
    return { next, res };
};

describe("json-server middleware", () => {
    it("login sets an HttpOnly session cookie on the happy path", () => {
        const { next, res } = runMiddleware({
            body: { email: "alice@example.com", password: "pw" },
            path: "/api/v1/auth/login"
        });

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining(`${SESSION_COOKIE}=`)
        );
        expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 when a non-auth route has no session cookie or bearer", () => {
        const { next, res } = runMiddleware({ path: "/projects" });
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});
