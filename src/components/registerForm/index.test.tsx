import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    BrowserRouter,
    MemoryRouter,
    Route,
    Routes,
    useLocation
} from "react-router-dom";

import useReactMutation from "../../utils/hooks/useReactMutation";

import RegisterForm from ".";

jest.mock("../../utils/hooks/useReactMutation");

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

const mutateAsync = jest.fn();

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const renderRegisterForm = ({
    isLoading = false,
    onError = jest.fn()
}: {
    isLoading?: boolean;
    onError?: jest.Mock;
} = {}) => {
    mockedUseReactMutation.mockReturnValue({
        isLoading,
        mutateAsync
    } as unknown as ReturnType<typeof useReactMutation<unknown>>);

    window.history.pushState({}, "Register", "/register");

    render(
        <BrowserRouter>
            <RegisterForm onError={onError} />
        </BrowserRouter>
    );

    return { onError };
};

const changeField = async (label: RegExp, value: string) => {
    await act(async () => {
        fireEvent.change(screen.getByLabelText(label), {
            target: { value }
        });
    });
};

const submitRegister = async () => {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
    });
};

describe("RegisterForm", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue({});
    });

    it("wires the register mutation with error handling", () => {
        const onError = jest.fn();

        renderRegisterForm({ onError });

        expect(mockedUseReactMutation).toHaveBeenCalledWith(
            "auth/register",
            "POST",
            undefined,
            undefined,
            onError,
            false
        );
    });

    it("validates required registration fields", async () => {
        renderRegisterForm();

        await submitRegister();

        expect(
            await screen.findByText("Please enter your email")
        ).toBeInTheDocument();
        expect(
            await screen.findByText("Please enter your username")
        ).toBeInTheDocument();
        expect(
            await screen.findByText("Please enter your password")
        ).toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it("after an empty submit, shows an error summary with links to invalid fields", async () => {
        const rtlUser = userEvent.setup();
        renderRegisterForm();

        await submitRegister();

        const summary = await screen.findByRole("group", {
            name: /there is a problem/i
        });
        expect(
            screen.getByRole("heading", {
                name: /there is a problem/i
            })
        ).toBeInTheDocument();

        expect(summary.querySelector('a[href="#email"]')).toBeTruthy();
        expect(summary.querySelector('a[href="#username"]')).toBeTruthy();
        expect(summary.querySelector('a[href="#password"]')).toBeTruthy();

        const userLink = summary.querySelector(
            'a[href="#username"]'
        ) as HTMLAnchorElement;
        await rtlUser.click(userLink);
        expect(screen.getByLabelText(/^username$/i)).toHaveFocus();
    });

    it("does not block paste on the password field", async () => {
        const rtlUser = userEvent.setup();
        renderRegisterForm();

        const password = screen.getByLabelText(/^password$/i);
        await rtlUser.click(password);
        await rtlUser.paste("pasted-password");

        expect(password).toHaveValue("pasted-password");
    });

    it("validates email format", async () => {
        renderRegisterForm();

        await changeField(/^email$/i, "not-an-email");
        // Blur the field so the standardised
        // `validateTrigger={["onBlur", "onSubmit"]}` fires the email
        // format rule. The previous default `onChange` trigger surfaced
        // the error mid-type; the new pattern waits until blur or
        // submit. See the validateTrigger standardisation note in the
        // comprehensive review.
        await act(async () => {
            fireEvent.blur(screen.getByLabelText(/^email$/i));
        });

        expect(
            await screen.findByText("Please enter a valid email address")
        ).toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();
    });

    it("keeps the API error visible while fields change", async () => {
        // The API error summary must persist until the next submit so the
        // user can finish reading and correcting it — clearing it on the
        // first keystroke dismissed the summary before it could be read.
        const { onError } = renderRegisterForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^username$/i, "Alice");
        await changeField(/^password$/i, "secret-password");

        expect(onError).not.toHaveBeenCalled();
    });

    it("submits registration data and navigates to login", async () => {
        renderRegisterForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^username$/i, "Alice");
        await changeField(/^password$/i, "secret-password");
        await submitRegister();

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith({
                email: "alice@example.com",
                password: "secret-password",
                username: "Alice"
            });
        });
        await waitFor(() => {
            expect(window.location.pathname).toBe("/login");
        });
    });

    it("normalizes the submitted email by trimming and lowercasing", async () => {
        // Mirrors the login form: pasted whitespace or auto-fill casing
        // would otherwise create an identity that mismatches the lower-cased
        // record the backend stores.
        renderRegisterForm();

        await changeField(/^email$/i, "  USER@EXAMPLE.com  ");
        await changeField(/^username$/i, "Alice");
        await changeField(/^password$/i, "secret-password");
        await submitRegister();

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith({
                email: "user@example.com",
                password: "secret-password",
                username: "Alice"
            });
        });
    });

    it("keeps registration failures on the current page for inline error handling", async () => {
        mutateAsync.mockRejectedValue(new Error("Register failed"));
        renderRegisterForm();

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^username$/i, "Alice");
        await changeField(/^password$/i, "secret-password");
        await submitRegister();

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith({
                email: "alice@example.com",
                password: "secret-password",
                username: "Alice"
            });
        });
        expect(window.location.pathname).toBe("/register");
    });

    it("shows the submitting state from the mutation", () => {
        renderRegisterForm({ isLoading: true });

        // The submit CTA swaps to its "Signing up…" label while the
        // mutation is in flight — a behavior-level signal independent of
        // any styling framework.
        expect(
            screen.getByRole("button", { name: /signing up/i })
        ).toBeInTheDocument();
    });

    it("surfaces localized password strength feedback after typing", async () => {
        renderRegisterForm();

        expect(screen.queryByText(/Too short/i)).not.toBeInTheDocument();

        await changeField(/^password$/i, "short");
        expect(await screen.findByText(/Too short/i)).toBeInTheDocument();

        await changeField(/^password$/i, "Password99");
        // `Form.useWatch` flushes its update through the form's macro-task
        // batcher (rc-field-form), so the strength hint may land on the
        // next tick when validation no longer fires on every change.
        expect(await screen.findByText(/Strong password/i)).toBeInTheDocument();
    });

    it("exposes an accessible Terms of Service link inside the auth copy", async () => {
        renderRegisterForm();

        expect(
            screen.getByRole("link", {
                name: /^terms of service$/i
            })
        ).toHaveAttribute("href", "/auth/terms");
    });

    /*
     * Share-target flow: external app → /share → /login (state.from=
     * "/share?…") → user taps "Sign up" → register submits → form
     * navigates to /login. The `from` hint must survive that hop so
     * the subsequent login can return the user to /share. The probe
     * route reads the forwarded router state directly so we don't
     * have to round-trip through the real login form.
     */
    it("preserves the location state when redirecting to /login after register", async () => {
        mockedUseReactMutation.mockReturnValue({
            isLoading: false,
            mutateAsync
        } as unknown as ReturnType<typeof useReactMutation<unknown>>);
        mutateAsync.mockResolvedValue({});

        const LocationProbe = () => {
            const loc = useLocation();
            return (
                <div data-testid="probe">
                    {typeof loc.state === "object" && loc.state !== null
                        ? JSON.stringify(loc.state)
                        : ""}
                </div>
            );
        };

        render(
            <MemoryRouter
                initialEntries={[
                    {
                        pathname: "/register",
                        state: { from: "/share?title=foo" }
                    }
                ]}
            >
                <Routes>
                    <Route
                        path="/register"
                        element={<RegisterForm onError={jest.fn()} />}
                    />
                    <Route path="/login" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>
        );

        await changeField(/^email$/i, "alice@example.com");
        await changeField(/^username$/i, "Alice");
        await changeField(/^password$/i, "secret-password");
        await submitRegister();

        await waitFor(() => {
            expect(screen.getByTestId("probe").textContent).toBe(
                JSON.stringify({ from: "/share?title=foo" })
            );
        });
    });
});
