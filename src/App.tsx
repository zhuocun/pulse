import "./App.css";
import { useMemo } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import ErrorBoundary from "./components/errorBoundary";
import routes from "./routes";

interface AppProps {
    router?: ReturnType<typeof createBrowserRouter>;
}

const App = ({ router }: AppProps) => {
    const browserRouter = useMemo(
        () => router ?? createBrowserRouter(routes),
        [router]
    );
    return (
        <div>
            <ErrorBoundary>
                <RouterProvider router={browserRouter} />
            </ErrorBoundary>
        </div>
    );
};

export default App;
