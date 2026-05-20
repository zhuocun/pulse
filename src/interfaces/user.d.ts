interface IUser extends IMember {
    likedProjects: string[];
    /**
     * Short-lived (``scp=ai_proxy``) bearer for the AI proxy, returned
     * in the ``POST /auth/login`` response. Lives in ``sessionStorage``
     * separately from the REST session (which rides an HttpOnly cookie
     * the browser sends automatically on same-origin REST calls).
     * Kept in JS-readable storage because AI calls may target a
     * different origin from the cookie's host, so they still need an
     * explicit ``Authorization: Bearer …`` header.
     */
    ai_jwt?: string;
}
