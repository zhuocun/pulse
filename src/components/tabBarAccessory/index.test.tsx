import { act, render, screen, waitFor } from "@testing-library/react";

import TabBarAccessory, {
    resetTabBarAccessoryForTests,
    TabBarAccessoryMount
} from ".";

/*
 * The TabBarAccessory pair uses a module-singleton stack to teleport
 * children from any subtree to the singleton mount point. Reset it
 * between tests so a leaked mount from one case (e.g. a render that
 * `unmount()` didn't tear down) never poisons the next.
 */
beforeEach(() => {
    resetTabBarAccessoryForTests();
});

afterEach(() => {
    // Belt-and-suspenders cleanup — explicitly clear the persistent
    // body-portal DOM node so the next test starts with a clean slate.
    const slot = document.getElementById("pulse-tab-accessory-slot");
    if (slot) slot.remove();
});

describe("TabBarAccessory", () => {
    it("renders nothing when no <TabBarAccessory> source is mounted", () => {
        render(<TabBarAccessoryMount />);
        // The fixed slot wrapper renders, but the glass chrome only
        // materializes when content exists. The region landmark is the
        // tell — without content, there's no role="region" in the tree.
        expect(
            screen.queryByRole("region", { name: /tab bar accessory/i })
        ).not.toBeInTheDocument();
    });

    it("renders the child once a <TabBarAccessory> mounts somewhere", () => {
        render(
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="content">Now playing</span>
                </TabBarAccessory>
            </>
        );
        expect(screen.getByTestId("content")).toBeInTheDocument();
        expect(
            screen.getByRole("region", { name: /tab bar accessory/i })
        ).toBeInTheDocument();
    });

    it("can be declared in a sibling subtree (not just below the mount)", () => {
        // The portal pattern lets the source live anywhere — including
        // a sibling that is not a descendant of the mount.
        render(
            <div>
                <section>
                    <TabBarAccessoryMount />
                </section>
                <section>
                    <TabBarAccessory>
                        <span data-testid="content">In a sibling</span>
                    </TabBarAccessory>
                </section>
            </div>
        );
        expect(screen.getByTestId("content")).toHaveTextContent("In a sibling");
    });

    it("warns and replaces when a second <TabBarAccessory> mounts", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
            // intentional silence — we assert on the call below
        });
        render(
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="first">first</span>
                </TabBarAccessory>
                <TabBarAccessory>
                    <span data-testid="second">second</span>
                </TabBarAccessory>
            </>
        );
        // Last-wins: the second instance is the visible one.
        expect(screen.getByTestId("second")).toBeInTheDocument();
        expect(screen.queryByTestId("first")).not.toBeInTheDocument();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Multiple <TabBarAccessory>")
        );
        warnSpy.mockRestore();
    });

    it("unmounts cleanly after the dematerialize window: empty slot when source is removed", async () => {
        const { rerender } = render(
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="content">visible</span>
                </TabBarAccessory>
            </>
        );
        expect(screen.getByTestId("content")).toBeInTheDocument();

        // Re-render WITHOUT the source — the chrome stays mounted briefly
        // so the dematerialize animation can play, then unmounts.
        act(() => {
            rerender(
                <>
                    <TabBarAccessoryMount />
                </>
            );
        });
        // A11y: after the dematerialize window passes, no stray landmark.
        await waitFor(() => {
            expect(screen.queryByTestId("content")).not.toBeInTheDocument();
            expect(
                screen.queryByRole("region", { name: /tab bar accessory/i })
            ).not.toBeInTheDocument();
        });
    });

    it("restores the previous accessory when the top mount unmounts (LIFO ladder)", async () => {
        // iOS uses a stack so a transient overlay (active call) can sit on
        // top of a longer-lived one (mini player). When the top entry pops,
        // the buried one resurfaces instead of leaving an empty slot.
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
            // intentional silence — stack-replace warns; not asserted here
        });
        const Two: React.FC = () => (
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="first">A</span>
                </TabBarAccessory>
                <TabBarAccessory>
                    <span data-testid="second">B</span>
                </TabBarAccessory>
            </>
        );
        const One: React.FC = () => (
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="first">A</span>
                </TabBarAccessory>
            </>
        );
        const { rerender } = render(<Two />);
        expect(screen.getByTestId("second")).toBeInTheDocument();

        act(() => {
            rerender(<One />);
        });
        // After the top entry pops, the buried first entry should resurface
        // without going through the dematerialize → null cycle.
        await waitFor(() => {
            expect(screen.getByTestId("first")).toBeInTheDocument();
        });
        warnSpy.mockRestore();
    });

    it("updates the slot when the source's children change", () => {
        const Host: React.FC<{ label: string }> = ({ label }) => (
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span data-testid="content">{label}</span>
                </TabBarAccessory>
            </>
        );
        const { rerender } = render(<Host label="initial" />);
        expect(screen.getByTestId("content")).toHaveTextContent("initial");

        act(() => {
            rerender(<Host label="updated" />);
        });
        expect(screen.getByTestId("content")).toHaveTextContent("updated");
    });

    it("does not warn on a single mount (clean lifecycle)", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
            // intentional silence
        });
        render(
            <>
                <TabBarAccessoryMount />
                <TabBarAccessory>
                    <span>only one</span>
                </TabBarAccessory>
            </>
        );
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it("a11y: glass chrome is omitted entirely when slot is empty (no role/region pollution)", () => {
        render(<TabBarAccessoryMount />);
        // The portal slot div may exist, but the glass region must not.
        const slot = document.querySelector(
            '[data-testid="tab-bar-accessory-slot"]'
        );
        expect(slot).not.toBeNull();
        expect(slot?.querySelector('[role="region"]')).toBeNull();
    });
});
