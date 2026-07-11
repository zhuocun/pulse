import { microcopy } from "../../constants/microcopy";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Text } from "../ui/typography";

const FULL_PAGE_CLASS =
    "flex h-[100dvh] w-full flex-col items-center justify-center gap-md p-lg text-center text-foreground";

const PageSpin: React.FC = () => {
    return (
        <div className={FULL_PAGE_CLASS} role="status" aria-live="polite">
            <Spinner size="lg" label={microcopy.a11y.loadingPage} />
            <Text type="secondary">
                {microcopy.empty.commandPalette.loading}
            </Text>
        </div>
    );
};

const PageError: React.FC<{ error: Error | null; onRetry?: () => void }> = ({
    error,
    onRetry
}) => {
    return (
        <div className={FULL_PAGE_CLASS} role="alert">
            <Text className="text-lg font-semibold" type="danger">
                {error?.message || microcopy.feedback.loadFailed}
            </Text>
            {onRetry ? (
                <Button onClick={onRetry} variant="primary">
                    {microcopy.actions.retry}
                </Button>
            ) : null}
        </div>
    );
};

export { PageError, PageSpin };
