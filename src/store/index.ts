import { configureStore } from "@reduxjs/toolkit";

import { activityFeedSlice } from "./reducers/activityFeedSlice";
import { aiLedgerSlice } from "./reducers/aiLedgerSlice";
import { overlaysSlice } from "./reducers/overlaysSlice";
import { projectModalSlice } from "./reducers/projectModalSlice";

export const rootReducer = {
    projectModal: projectModalSlice.reducer,
    overlays: overlaysSlice.reducer,
    aiLedger: aiLedgerSlice.reducer,
    activityFeed: activityFeedSlice.reducer
};

export const store = configureStore({
    reducer: rootReducer
});

export type ReduxDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
