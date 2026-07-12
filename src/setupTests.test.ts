test("loads jest-dom matchers for the test harness", () => {
    const element = document.createElement("div");

    element.textContent = "ready";

    expect(element).toHaveTextContent("ready");
});

test("polyfills matchMedia for the responsive/motion hooks", () => {
    expect(window.matchMedia).toEqual(expect.any(Function));
});
