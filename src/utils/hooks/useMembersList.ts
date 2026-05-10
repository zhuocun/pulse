import useReactQuery from "./useReactQuery";

export const MEMBERS_LIST_ENDPOINT = "users/members";
export const MEMBERS_LIST_QUERY_KEY = [MEMBERS_LIST_ENDPOINT] as const;
export const MEMBERS_LIST_STALE_TIME_MS = 5 * 60 * 1000;

const useMembersList = () =>
    useReactQuery<IMember[]>(
        MEMBERS_LIST_ENDPOINT,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        {
            staleTime: MEMBERS_LIST_STALE_TIME_MS
        }
    );

export default useMembersList;
