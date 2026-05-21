import { Action, ActionCreatorWithoutPayload } from "@reduxjs/toolkit";
import { useCallback } from "react";

import { RootState } from "../../store";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Shared open/close + selected-value plumbing for every URL-independent
 * overlay — task modal, AI chat drawer, board brief drawer, AI
 * task-draft modal, project modal.
 *
 * The family used to derive each modal's open flag from a URL search
 * param (`?editingTaskId`, `?chat`, `?brief`, `?aiDraft`, `?modal`) so
 * the system back button could dismiss the overlay and deep links
 * worked. On iOS Safari WebKit, React Router's context propagation
 * never reached the modal subtree after a `setSearchParams` write, so
 * the click updated the URL bar but the modal never opened — see PR
 * #226 for the first migration (`useProjectModal`). Redux +
 * `react-redux`'s `useSyncExternalStore`-backed subscription is the
 * most reliable cross-subtree propagation primitive in React;
 * dispatches are synchronous, so the modal flips in the same render as
 * the click. Trade-off accepted: deep links to `?modal=on` and the
 * back-button gesture no longer auto-open overlays.
 *
 * Each user-facing hook (`useTaskModal`, `useAiChatDrawer`, …) is a
 * thin alias that calls this factory and renames the generic
 * `{ value, open, close }` to whatever names that overlay exposes.
 */
type OpenAction<TArg> = TArg extends void
    ? ActionCreatorWithoutPayload
    : (arg: TArg) => Action;

interface OverlayHookConfig<TValue, TArg> {
    select: (state: RootState) => TValue;
    openAction: OpenAction<TArg>;
    closeAction: ActionCreatorWithoutPayload;
}

const createOverlayHook = <TValue, TArg = void>(
    config: OverlayHookConfig<TValue, TArg>
) => {
    const { select, openAction, closeAction } = config;
    return () => {
        const dispatch = useReduxDispatch();
        const value = useReduxSelector(select);
        const open = useCallback(
            (arg?: TArg) => {
                dispatch((openAction as (arg?: TArg) => Action)(arg as TArg));
            },
            [dispatch]
        );
        const close = useCallback(() => {
            dispatch(closeAction());
        }, [dispatch]);
        return {
            value,
            open: open as TArg extends void ? () => void : (arg: TArg) => void,
            close
        };
    };
};

export default createOverlayHook;
