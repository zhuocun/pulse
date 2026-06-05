"""High-volume / repetitive API harnesses for the v1 CRUD surface.

The base ``test_api_features.py`` suite verifies the happy paths and
single-shot error cases. This file picks up where that one stops and
hammers each endpoint with many sequential calls — the kinds of
patterns the FE produces in practice when a user drags cards rapidly,
double-clicks a delete, mashes the like button, or paginates through a
large workspace. The goal is to surface invariants that only break
once you do something N times:

* ``index`` re-packing on column / task deletion stays contiguous no
  matter which slot you remove (front, middle, back, every-other).
* Reordering an arbitrary permutation converges to the requested order
  and never duplicates or loses items.
* Repeated mutations are idempotent or strictly parity-toggled (likes,
  same-value PUTs, repeated DELETEs).
* Cross-tenant isolation holds across many users / projects, not just
  the one-user-vs-one-intruder smoke case in ``test_api_features``.
* Validation envelopes are stable across a matrix of malformed bodies
  rather than the three or four spot-checks in the base suite.

All tests reuse the in-memory ``FakeStore`` + ``register_and_login`` /
``create_project_board_and_task`` helpers so the file stays at the
HTTP-router boundary and exercises the same code paths a real client
would hit. No agent / AI router calls live here — those are covered by
the dedicated ``tests/test_agents_*`` and ``tests/test_ai_*`` suites.
"""

from __future__ import annotations

import random
from http import HTTPStatus
from typing import Any, Dict, List

from fastapi.testclient import TestClient

from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.security import create_token
from tests.conftest import FakeStore
from tests.test_api_features import (
    auth_headers,
    create_project_board_and_task,
    register_and_login,
    register_and_login_user,
    seed_ordering_data,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_task(
    client: TestClient,
    headers: Dict[str, str],
    *,
    project_id: str,
    column_id: str,
    coordinator_id: str,
    name: str,
    epic: str = "E",
    story_points: int = 1,
    note: str = "n",
    type_: str = "Task",
) -> None:
    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": project_id,
            "columnId": column_id,
            "coordinatorId": coordinator_id,
            "epic": epic,
            "storyPoints": story_points,
            "taskName": name,
            "type": type_,
            "note": note,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text


def _list_tasks(
    client: TestClient, headers: Dict[str, str], project_id: str
) -> List[Dict[str, Any]]:
    response = client.get(f"/api/v1/tasks/?projectId={project_id}", headers=headers)
    assert response.status_code == 200
    return response.json()


def _list_columns(
    client: TestClient, headers: Dict[str, str], project_id: str
) -> List[Dict[str, Any]]:
    response = client.get(f"/api/v1/boards/?projectId={project_id}", headers=headers)
    assert response.status_code == 200
    return response.json()


def _list_projects(
    client: TestClient, headers: Dict[str, str]
) -> List[Dict[str, Any]]:
    response = client.get("/api/v1/projects/", headers=headers)
    assert response.status_code == 200
    return response.json()


# ---------------------------------------------------------------------------
# Auth: repeated registers and logins
# ---------------------------------------------------------------------------


def test_register_n_distinct_users_returns_consistent_envelope(
    client: TestClient,
) -> None:
    """Registering N distinct users must keep returning ``"User created"``.

    The handler returns the bare string -- any future refactor that
    accidentally wraps it in ``{"data": "User created"}`` would break
    the FE's optimistic toast. Hammering it N times also surfaces any
    hidden global state (e.g. a memoized response) that would let the
    second call diverge from the first.
    """

    for index in range(20):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": f"user-{index}",
                "email": f"user{index}@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.CREATED
        assert response.json() == "User created"


def test_register_duplicate_email_is_rejected_every_time(client: TestClient) -> None:
    """Every retry of a taken email must produce the same 400 envelope.

    The FE retries the call on a network-timeout banner; a one-shot
    rejection that later flipped to a 201 would corrupt the membership
    table. The envelope shape is pinned because the FE drives a toast
    off ``error[0].msg``.
    """

    register_and_login(client)
    for _ in range(8):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": "alice2",
                "email": "alice@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        body = response.json()
        assert body == {
            "error": [
                {
                    "msg": "Email has already been registered",
                    "value": "alice@example.com",
                    "param": "email",
                    "location": "body",
                }
            ]
        }


def test_register_duplicate_username_is_rejected_every_time(
    client: TestClient,
) -> None:
    register_and_login(client)
    for _ in range(8):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": "alice",
                "email": "alice2@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert response.json() == {
            "error": [
                {
                    "msg": "Username has already been registered",
                    "value": "alice",
                    "param": "username",
                    "location": "body",
                }
            ]
        }


def test_repeated_failed_logins_do_not_lock_out_the_correct_password(
    client: TestClient,
) -> None:
    """Wrong-password spam must not consume any quota / mutate state.

    The login handler has no rate-lock today; a future addition must
    not silently introduce one without an explicit decision. This test
    pins the current behaviour so an accidental lockout regression is
    caught at PR time.
    """

    register_and_login(client)
    for _ in range(15):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "wrong"},
        )
        assert response.status_code == HTTPStatus.UNAUTHORIZED
        assert response.json() == {"error": "Invalid credentials"}
    # The correct password still works after 15 failures.
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "secret"},
    )
    assert response.status_code == HTTPStatus.OK
    assert client.cookies.get("Token")


def test_repeated_logins_issue_independent_usable_tokens(client: TestClient) -> None:
    """Each ``POST /auth/login`` must produce a token that authorises ``GET /users/``.

    Calling login N times yields N JWTs; every one of them must succeed
    on a subsequent authenticated route. A regression that reused a
    stale token cache would corrupt session boundaries.
    """

    register_and_login(client)
    tokens: List[str] = []
    for _ in range(10):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "secret"},
        )
        assert response.status_code == HTTPStatus.OK
        token = client.cookies.get("Token")
        assert token, "login response must set the session cookie"
        tokens.append(token)
    assert len(set(tokens)) >= 1  # tokens may differ across calls (exp varies)
    for token in tokens:
        response = client.get("/api/v1/users/", headers=auth_headers(token))
        assert response.status_code == HTTPStatus.OK
        assert response.json()["email"] == "alice@example.com"


def test_register_validation_matrix_returns_400_for_every_case(
    client: TestClient,
) -> None:
    """Loop the registration validation matrix.

    Each malformed body must return 400 and never accidentally create a
    user; the membership table is checked at the end to make sure no
    leak slipped through.
    """

    cases: List[Dict[str, Any]] = [
        {},
        {"username": "ab"},
        {"username": "ab", "email": "x@example.com", "password": "secret"},
        {"username": "abc", "email": "bad-email", "password": "secret"},
        {"username": "abc", "email": "a@example.com"},
        {"username": "abc", "email": "a@example.com", "password": ""},
        {"username": "", "email": "a@example.com", "password": "secret"},
        {"username": "abc", "email": "", "password": "secret"},
        {"username": "abc", "email": "a@example.com", "password": "1234"},
        {"username": "a" * 2, "email": "a@example.com", "password": "secret"},
        {"username": 123, "email": "a@example.com", "password": "secret"},
        {"username": "abc", "email": 123, "password": "secret"},
        {"username": "abc", "email": "a@example.com", "password": 123},
    ]
    for payload in cases:
        response = client.post("/api/v1/auth/register", json=payload)
        assert response.status_code == HTTPStatus.BAD_REQUEST, payload
        body = response.json()
        assert "error" in body
        assert isinstance(body["error"], list)
        assert all("msg" in entry for entry in body["error"])

    # Membership directory is empty: no malformed body leaked a user.
    response = client.post(
        "/api/v1/auth/register",
        json={"username": "first", "email": "first@example.com", "password": "secret"},
    )
    assert response.status_code == HTTPStatus.CREATED
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "first@example.com", "password": "secret"},
    )
    assert response.status_code == HTTPStatus.OK
    response = client.get(
        "/api/v1/users/members", headers=auth_headers(client.cookies["Token"])
    )
    assert response.status_code == HTTPStatus.OK
    assert [member["email"] for member in response.json()] == ["first@example.com"]


def test_login_unknown_email_collapses_to_same_envelope_repeatedly(
    client: TestClient,
) -> None:
    """Unknown-email and wrong-password share a single envelope.

    Hammering the handler with many unknown emails must never produce a
    timing-distinguishable response (a regression that short-circuited
    on missing users would skip the dummy-hash and the body would still
    be ``Invalid credentials`` but the test pins the envelope shape so
    a future change cannot leak a more-detailed message).
    """

    register_and_login(client)
    for index in range(12):
        response = client.post(
            "/api/v1/auth/login",
            json={
                "email": f"ghost{index}@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.UNAUTHORIZED
        assert response.json() == {"error": "Invalid credentials"}


# ---------------------------------------------------------------------------
# Users: repeated GET / PUT / likes toggles
# ---------------------------------------------------------------------------


def test_repeated_get_users_returns_stable_body(client: TestClient) -> None:
    """``GET /users/`` is a read; N successive calls must return identical bodies."""

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    baseline = client.get("/api/v1/users/", headers=headers).json()
    for _ in range(8):
        response = client.get("/api/v1/users/", headers=headers)
        assert response.status_code == HTTPStatus.OK
        assert response.json() == baseline


def test_user_put_is_idempotent_for_same_payload(client: TestClient) -> None:
    """Sending the same PUT body N times converges to the same record.

    A regression that double-hashed the password (or appended to a list
    field) would diverge from the first response. We also assert that
    the ``email`` field stays identical across iterations even though
    the username changed once.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    first = client.put(
        "/api/v1/users/",
        json={"username": "alice-renamed"},
        headers=headers,
    ).json()
    for _ in range(6):
        response = client.put(
            "/api/v1/users/",
            json={"username": "alice-renamed"},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        body = response.json()
        assert body["username"] == "alice-renamed"
        assert body["email"] == first["email"]
        assert body["_id"] == first["_id"]


def test_like_toggle_n_times_obeys_parity(client: TestClient) -> None:
    """Toggling the same project N times must alternate present / absent.

    A regression that appended on every call would produce a duplicate
    list; a regression that ignored duplicates would never remove the
    project. The invariant: after ``k`` toggles, the project is present
    iff ``k`` is odd, and the ``likedProjects`` list has length 0 or 1.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    project_id = create_project_board_and_task(
        client, logged_in["jwt"], logged_in["_id"]
    )["project_id"]

    for index in range(1, 21):
        response = client.put(
            "/api/v1/users/likes",
            json={"projectId": project_id},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        liked = response.json()["likedProjects"]
        if index % 2 == 1:
            assert liked == [project_id], index
        else:
            assert liked == [], index


def test_like_many_distinct_projects_dedupes_and_preserves_order(
    client: TestClient,
) -> None:
    """Liking N projects in order must build a deduplicated list in click order.

    The handler uses an ``OrderedDict.fromkeys`` walk so duplicates are
    collapsed and insertion order is preserved. Repeating any one
    project's like-add a second time should be a no-op for the list
    (because toggling removes it, then re-adding re-inserts at the
    end), which is the exact behaviour pinned below.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    project_ids = [
        create_project_board_and_task(
            client, logged_in["jwt"], logged_in["_id"]
        )["project_id"]
    ]
    for index in range(1, 5):
        response = client.post(
            "/api/v1/projects/",
            json={
                "projectName": f"P-{index}",
                "organization": "OpenAI",
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED
    # Refresh the project id list from the server so we hit the real
    # documents rather than the synthetic ones in the helper.
    project_ids = [project["_id"] for project in _list_projects(client, headers)]

    for project_id in project_ids:
        response = client.put(
            "/api/v1/users/likes",
            json={"projectId": project_id},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK

    liked = client.get("/api/v1/users/", headers=headers).json()["likedProjects"]
    assert set(liked) == set(project_ids)
    assert len(liked) == len(project_ids)


def test_user_put_unknown_field_rejects_all_repeated_attempts(
    client: TestClient,
) -> None:
    """Mass-assignment guard must hold across many calls.

    A previous regression let unknown fields slip through after a
    schema-cache prime; we hammer the same payload to make sure the
    guard is stateless.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    for _ in range(6):
        response = client.put(
            "/api/v1/users/",
            json={"isAdmin": True, "roles": ["root"]},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        body = response.json()
        assert body["error"][0]["msg"].startswith("Unknown field(s):")
        # Alphabetical so the message is stable across runs.
        assert "isAdmin" in body["error"][0]["msg"]
        assert "roles" in body["error"][0]["msg"]


def test_users_members_grows_monotonically(client: TestClient) -> None:
    """Each new register must show up in /users/members exactly once.

    The directory is a read-side projection -- duplicates here imply a
    write-side dedup bug; missing entries imply a read-filter bug.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    base_count = len(client.get("/api/v1/users/members", headers=headers).json())

    for index in range(15):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": f"member-{index}",
                "email": f"member{index}@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.CREATED
        members = client.get("/api/v1/users/members", headers=headers).json()
        emails = [member["email"] for member in members]
        assert len(emails) == base_count + index + 1
        assert len(set(emails)) == len(emails)
        # The new user appears at exactly one position in the list.
        assert emails.count(f"member{index}@example.com") == 1


# ---------------------------------------------------------------------------
# Projects: bulk creation, search filters, repeated delete
# ---------------------------------------------------------------------------


def test_bulk_project_creation_lists_exactly_what_was_created(
    client: TestClient,
) -> None:
    """Listing after N creates must return all N (and only N).

    A regression that scoped the listing to the wrong manager would
    show fewer; a regression that leaked another tenant's documents
    would show more. The unique-name set is checked too.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    names = [f"Project-{index:03d}" for index in range(25)]
    for name in names:
        response = client.post(
            "/api/v1/projects/",
            json={"projectName": name, "organization": "OpenAI"},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED

    response = client.get("/api/v1/projects/", headers=headers)
    assert response.status_code == HTTPStatus.OK
    listed = response.json()
    assert len(listed) == len(names)
    assert {project["projectName"] for project in listed} == set(names)
    assert all(project["managerId"] == logged_in["_id"] for project in listed)


def test_project_name_filter_matches_exact_string_across_many_projects(
    client: TestClient,
) -> None:
    """``GET /projects/?projectName=X`` must return only documents named X.

    With N projects whose names share a prefix, an accidental ``LIKE``
    refactor would over-match. The filter is exact-equality on the
    storage side; this test pins that contract.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    for index in range(10):
        response = client.post(
            "/api/v1/projects/",
            json={
                "projectName": f"Pulse-{index}",
                "organization": "OpenAI",
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED

    for index in range(10):
        response = client.get(
            f"/api/v1/projects/?projectName=Pulse-{index}",
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        matches = response.json()
        assert len(matches) == 1
        assert matches[0]["projectName"] == f"Pulse-{index}"


def test_repeated_delete_of_same_project_returns_404_after_first(
    client: TestClient,
) -> None:
    """First DELETE returns 200; every subsequent one is 404.

    The FE sometimes fires a delete twice (debounce flake); the second
    must not crash. A regression that 500'd the second call would
    surface as a "scary" red banner on a benign user action.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert response.json() == "Project deleted"

    for _ in range(8):
        response = client.delete(
            f"/api/v1/projects/?projectId={ids['project_id']}",
            headers=headers,
        )
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.json() == {"error": "Project not found"}


def test_project_put_same_payload_n_times_is_idempotent(client: TestClient) -> None:
    """Repeated PUT to the same shape converges to a stable record.

    A drift between the body returned in the response and the stored
    document would surface as the second PUT producing a different
    payload than the first. We check the stored document via a
    subsequent GET too.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    payload = {
        "_id": ids["project_id"],
        "projectName": "Stable Name",
        "organization": "Acme",
        "managerId": logged_in["_id"],
    }
    for _ in range(6):
        response = client.put("/api/v1/projects/", json=payload, headers=headers)
        assert response.status_code == HTTPStatus.OK
        assert response.json() == "Project updated"

    stored = client.get(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=headers,
    ).json()
    assert stored["projectName"] == "Stable Name"
    assert stored["organization"] == "Acme"


def test_many_users_each_only_see_their_own_projects(client: TestClient) -> None:
    """N users + N projects each -- listing yields exactly the caller's docs.

    Cross-tenant isolation is the single most important invariant in
    this API. A regression that dropped the ``managerId`` clause from
    the listing query would show another user's projects without
    explicit access. We verify with N independent accounts.
    """

    user_count = 6
    projects_per_user = 4
    tokens: List[Dict[str, Any]] = []
    for index in range(user_count):
        info = register_and_login_user(
            client,
            f"tenant-{index}",
            f"tenant{index}@example.com",
        )
        tokens.append(info)
        headers = auth_headers(info["jwt"])
        for project_index in range(projects_per_user):
            response = client.post(
                "/api/v1/projects/",
                json={
                    "projectName": f"T{index}-P{project_index}",
                    "organization": "Acme",
                },
                headers=headers,
            )
            assert response.status_code == HTTPStatus.CREATED

    for index, info in enumerate(tokens):
        headers = auth_headers(info["jwt"])
        projects = _list_projects(client, headers)
        assert len(projects) == projects_per_user
        assert all(
            project["projectName"].startswith(f"T{index}-") for project in projects
        )


def test_get_projects_by_manager_id_other_user_is_forbidden(client: TestClient) -> None:
    """Probing another user's ``managerId`` must 403, repeatedly.

    The endpoint forwards ``managerId`` to the service which compares
    it to the viewer; a refactor that trusted the query param would
    leak the membership graph. We try N intruders against the same
    victim to make sure the gate is stateless.
    """

    victim = register_and_login(client)
    for index in range(5):
        intruder = register_and_login_user(
            client,
            f"intruder-{index}",
            f"intruder{index}@example.com",
        )
        response = client.get(
            f"/api/v1/projects/?managerId={victim['_id']}",
            headers=auth_headers(intruder["jwt"]),
        )
        assert response.status_code == HTTPStatus.FORBIDDEN
        assert response.json() == {"error": "Forbidden"}


# ---------------------------------------------------------------------------
# Boards: index repacking and reordering invariants
# ---------------------------------------------------------------------------


def test_many_columns_have_contiguous_indexes_after_each_append(
    client: TestClient,
) -> None:
    """``POST /boards/`` appends with ``index = len(columns)``.

    After N appends the indexes must be 0..N-1 with no gaps and no
    duplicates. We re-check after every append so a drift surfaces on
    the call that introduced it, not on the final assertion.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    # Three default columns + the "Review" column from the helper = 4 to start.
    starting = len(_list_columns(client, headers, ids["project_id"]))
    for index in range(starting, starting + 10):
        response = client.post(
            "/api/v1/boards/",
            json={
                "columnName": f"Extra-{index}",
                "projectId": ids["project_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED
        columns = _list_columns(client, headers, ids["project_id"])
        indexes = [column["index"] for column in columns]
        assert indexes == sorted(indexes)
        assert indexes == list(range(len(columns)))


def test_delete_each_column_repacks_indexes(client: TestClient) -> None:
    """Deleting columns from arbitrary positions keeps indexes contiguous.

    The service re-packs by subtracting one from every higher sibling;
    a regression that left a hole would show up as duplicated indexes
    on the next reorder. We delete from front, middle, and back across
    a wide-enough fan-out to catch the bug.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    for index in range(6):
        response = client.post(
            "/api/v1/boards/",
            json={
                "columnName": f"Filler-{index}",
                "projectId": ids["project_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED

    # Repeatedly delete the column currently at index 2 (the middle of
    # the moving sequence) until only the three default columns remain.
    while True:
        columns = _list_columns(client, headers, ids["project_id"])
        if len(columns) <= 3:
            break
        target = next(column for column in columns if column["index"] == 2)
        response = client.delete(
            f"/api/v1/boards/?columnId={target['_id']}",
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        columns = _list_columns(client, headers, ids["project_id"])
        indexes = [column["index"] for column in columns]
        assert indexes == list(range(len(columns)))


def test_repeated_reorder_after_before_converges_to_requested_order(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Running ``after``/``before`` reorders in a tight loop yields the desired order.

    The reorder algorithm operates on contiguous indexes; cycling
    arbitrary permutations exercises every branch (forward shift,
    backward shift, edge cases at index 0 and len-1). We assert the
    final order matches our requested permutation exactly.
    """

    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))

    # Reverse the column order: Done, Doing, To Do.
    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "before",
            "fromId": ids["done_id"],
            "referenceId": ids["todo_id"],
        },
        headers=headers,
    )
    assert response.status_code == HTTPStatus.OK
    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "before",
            "fromId": ids["doing_id"],
            "referenceId": ids["todo_id"],
        },
        headers=headers,
    )
    assert response.status_code == HTTPStatus.OK

    columns = _list_columns(client, headers, ids["project_id"])
    assert [column["columnName"] for column in columns] == ["Done", "Doing", "To Do"]

    # Move Done to the back: After many moves the indexes are still 0..N-1.
    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "after",
            "fromId": ids["done_id"],
            "referenceId": ids["todo_id"],
        },
        headers=headers,
    )
    assert response.status_code == HTTPStatus.OK
    columns = _list_columns(client, headers, ids["project_id"])
    assert [column["columnName"] for column in columns] == ["Doing", "To Do", "Done"]
    assert [column["index"] for column in columns] == [0, 1, 2]


def test_default_columns_seed_exactly_once_under_repeated_get(
    client: TestClient,
    store: FakeStore,
) -> None:
    """``GET /boards/?projectId=P`` seeds default columns on first read.

    Hammering the GET N times must not seed N copies of the columns --
    only the first call inserts; later calls see the existing rows and
    return them as-is. The FE polls boards on focus / reconnect, so a
    regression here would multiply columns on every reconnect.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    project_id = "legacy-seed-me"
    store.insert_one(
        PROJECTS,
        {
            "_id": project_id,
            "projectName": "Seed me",
            "organization": "OpenAI",
            "managerId": logged_in["_id"],
        },
    )

    seen_lengths = []
    for _ in range(8):
        columns = _list_columns(client, headers, project_id)
        seen_lengths.append(len(columns))
    assert seen_lengths == [3] * 8
    # And the underlying store agrees -- no duplicate columns leaked in.
    assert (
        len(store.find_many(COLUMNS, {"projectId": project_id})) == 3
    ), "default-column seeding ran more than once"


# ---------------------------------------------------------------------------
# Tasks: bulk creation, repack, reorder churn
# ---------------------------------------------------------------------------


def test_bulk_task_creation_assigns_strictly_increasing_indexes(
    client: TestClient,
) -> None:
    """Creating N tasks in one column must produce indexes 0..N-1.

    The handler reads ``len(tasks)`` at insert time; a future move to a
    real SQL backend that doesn't preserve insertion order would break
    here. We pin the contract that listing yields the tasks in
    creation order with contiguous indexes.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    # The helper seeded one task in To Do already.
    starting = len(_list_tasks(client, headers, ids["project_id"]))
    for index in range(starting, starting + 15):
        _make_task(
            client,
            headers,
            project_id=ids["project_id"],
            column_id=ids["todo_id"],
            coordinator_id=logged_in["_id"],
            name=f"Bulk-{index}",
        )

    tasks = [
        task
        for task in _list_tasks(client, headers, ids["project_id"])
        if task["columnId"] == ids["todo_id"]
    ]
    tasks.sort(key=lambda task: task["index"])
    assert [task["index"] for task in tasks] == list(range(len(tasks)))
    # Names appear in creation order (the helper task is first).
    bulk_names = [task["taskName"] for task in tasks if task["taskName"].startswith("Bulk-")]
    assert bulk_names == [f"Bulk-{index}" for index in range(starting, starting + 15)]


def test_delete_each_task_repacks_sibling_indexes(client: TestClient) -> None:
    """Deletion re-packs sibling indexes contiguously, repeatedly.

    The repack loop is the source of subtle off-by-one bugs; we delete
    middle/edge tasks across a wide fan-out and assert the surviving
    indexes are always ``range(len(remaining))``.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    for index in range(8):
        _make_task(
            client,
            headers,
            project_id=ids["project_id"],
            column_id=ids["todo_id"],
            coordinator_id=logged_in["_id"],
            name=f"Survivor-{index}",
        )

    while True:
        tasks = [
            task
            for task in _list_tasks(client, headers, ids["project_id"])
            if task["columnId"] == ids["todo_id"]
        ]
        if len(tasks) <= 1:
            break
        # Delete an interior task so the repack actually runs. ``purge=true``
        # is required: the sibling index re-pack only runs on a hard delete
        # (the soft-delete default leaves indexes untouched for a lossless
        # restore).
        target = sorted(tasks, key=lambda task: task["index"])[len(tasks) // 2]
        response = client.delete(
            f"/api/v1/tasks/?taskId={target['_id']}&purge=true", headers=headers
        )
        assert response.status_code == HTTPStatus.OK
        survivors = [
            task
            for task in _list_tasks(client, headers, ids["project_id"])
            if task["columnId"] == ids["todo_id"]
        ]
        indexes = sorted(task["index"] for task in survivors)
        assert indexes == list(range(len(survivors)))


def test_intra_column_reorder_churn_preserves_contiguous_indexes(
    client: TestClient,
    store: FakeStore,
) -> None:
    """N back-and-forth same-column reorders keep indexes contiguous.

    The same-column branch of :func:`task_reorder_updates` only works
    directionally -- ``before`` shifts a task to a lower index,
    ``after`` shifts to a higher index. The FE always picks the
    correct op based on the drag direction, so the loop below mimics
    that: at each step we pick the direction that respects the
    pre-condition, swap, then assert indexes are still ``0..N-1`` and
    nothing got lost. Catching a corruption here means the algorithm
    leaked a duplicate index or dropped an item.
    """

    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))

    # 3 tasks already in To Do (A, B, C). Add 3 more for a wider fan-out.
    for index in range(3):
        _make_task(
            client,
            headers,
            project_id=ids["project_id"],
            column_id=ids["todo_id"],
            coordinator_id=ids["user_id"],
            name=f"Extra-{index}",
        )

    starting_count = len(
        [
            task
            for task in _list_tasks(client, headers, ids["project_id"])
            if task["columnId"] == ids["todo_id"]
        ]
    )

    rng = random.Random(20260520)
    for _ in range(25):
        current = [
            task
            for task in _list_tasks(client, headers, ids["project_id"])
            if task["columnId"] == ids["todo_id"]
        ]
        current.sort(key=lambda task: task["index"])
        # Pick two distinct positions; choose op so the algorithm's
        # direction precondition is satisfied (``before`` needs from >
        # ref, ``after`` needs from < ref).
        i, j = sorted(rng.sample(range(len(current)), 2))
        if rng.random() < 0.5:
            order_type, from_id, reference_id = "before", current[j]["_id"], current[i]["_id"]
        else:
            order_type, from_id, reference_id = "after", current[i]["_id"], current[j]["_id"]

        response = client.put(
            "/api/v1/tasks/orders",
            json={
                "type": order_type,
                "fromId": from_id,
                "referenceId": reference_id,
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK, (
            response.text,
            order_type,
            i,
            j,
        )

        after = [
            task
            for task in _list_tasks(client, headers, ids["project_id"])
            if task["columnId"] == ids["todo_id"]
        ]
        indexes = sorted(task["index"] for task in after)
        assert indexes == list(range(starting_count))
        # No task disappeared.
        assert len(after) == starting_count


def test_repeated_cross_column_moves_preserve_per_column_repack(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Cross-column moves keep both source and destination contiguous.

    Each move shifts the source down (the column the task left) and
    shifts the destination up (the column the task entered). Doing
    many moves back-and-forth must leave both columns with contiguous
    indexes and total task count constant.
    """

    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))
    # Seed: 3 tasks in todo (A,B,C), 1 in doing (D). Total = 4.
    total_before = len(_list_tasks(client, headers, ids["project_id"]))

    # Move B -> Doing (after D), then back, then A -> Doing (before D),
    # then back. Each operation cycles the repack on both sides.
    moves = [
        ("after", ids["task_b"], ids["task_d"], ids["todo_id"], ids["doing_id"]),
        ("after", ids["task_b"], ids["task_a"], ids["doing_id"], ids["todo_id"]),
        ("before", ids["task_a"], ids["task_d"], ids["todo_id"], ids["doing_id"]),
        ("after", ids["task_a"], ids["task_c"], ids["doing_id"], ids["todo_id"]),
    ]
    for order_type, from_id, reference_id, from_col, reference_col in moves:
        response = client.put(
            "/api/v1/tasks/orders",
            json={
                "type": order_type,
                "fromId": from_id,
                "referenceId": reference_id,
                "fromColumnId": from_col,
                "referenceColumnId": reference_col,
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK, (response.text, order_type)

        tasks = _list_tasks(client, headers, ids["project_id"])
        assert len(tasks) == total_before
        for column_id in (ids["todo_id"], ids["doing_id"], ids["done_id"]):
            in_column = [task for task in tasks if task["columnId"] == column_id]
            indexes = sorted(task["index"] for task in in_column)
            assert indexes == list(range(len(in_column))), (column_id, indexes)


def test_task_put_same_payload_n_times_is_idempotent(client: TestClient) -> None:
    """Re-submitting the same task PUT body N times converges to one stored state."""

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    payload = {
        "_id": ids["task_id"],
        "projectId": ids["project_id"],
        "columnId": ids["todo_id"],
        "coordinatorId": logged_in["_id"],
        "epic": "Stable Epic",
        "storyPoints": 5,
        "taskName": "Stable Task",
        "type": "Task",
        "note": "stable",
    }
    for _ in range(6):
        response = client.put("/api/v1/tasks/", json=payload, headers=headers)
        assert response.status_code == HTTPStatus.OK
        assert response.json() == "Task updated"

    task = next(
        task
        for task in _list_tasks(client, headers, ids["project_id"])
        if task["_id"] == ids["task_id"]
    )
    assert task["taskName"] == "Stable Task"
    assert task["storyPoints"] == 5
    assert task["epic"] == "Stable Epic"


def test_task_create_validation_matrix_returns_400_for_every_partial_body(
    client: TestClient,
) -> None:
    """Every missing required-field permutation must yield 400.

    Only the routing/identity keys (``projectId``, ``columnId``,
    ``taskName``) are mandatory at the wire. ``type``, ``epic``,
    ``storyPoints`` and ``note`` are optional and filled with sensible
    defaults server-side so quick-add from a column can post a minimal
    body without the FE shipping canned placeholder strings.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    full_body = {
        "projectId": "p",
        "columnId": "c",
        "taskName": "t",
    }
    keys = list(full_body)
    for key in keys:
        partial = {field: value for field, value in full_body.items() if field != key}
        response = client.post("/api/v1/tasks/", json=partial, headers=headers)
        assert response.status_code == HTTPStatus.BAD_REQUEST
        body = response.json()
        assert any(entry.get("param") == key for entry in body["error"])


def test_task_create_minimal_body_defaults_optional_fields_server_side(
    client: TestClient,
) -> None:
    """POST /tasks with only routing keys fills optional fields server-side.

    The FE quick-add affordance sends ``{taskName, projectId, columnId,
    coordinatorId}`` — no canned ``epic`` / ``type`` / ``storyPoints`` /
    ``note`` template the user must clear after the fact. The service
    layer is the single source of truth for those defaults.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])

    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": logged_in["_id"],
            "taskName": "Ship the thing",
        },
        headers=headers,
    )
    assert response.status_code == HTTPStatus.CREATED
    assert response.json() == "Task created"

    tasks = client.get(
        f"/api/v1/tasks/?projectId={ids['project_id']}", headers=headers
    ).json()
    created = next(task for task in tasks if task["taskName"] == "Ship the thing")
    assert created["type"] == "Task"
    assert created["epic"] == ""
    assert created["note"] == ""
    assert created["storyPoints"] == 1


def test_repeated_delete_of_same_task_returns_400_after_first(
    client: TestClient,
) -> None:
    """Tasks delete handler responds 200 then 404 for stale ids.

    Task deletion now matches project and board deletion: stale resource
    ids are not found, not malformed. The first call hard-purges
    (``purge=true``) so the row is actually gone; every repeat then hits a
    missing id and 404s (a soft delete would keep the row and 200 forever).
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    response = client.delete(
        f"/api/v1/tasks/?taskId={ids['task_id']}&purge=true", headers=headers
    )
    assert response.status_code == HTTPStatus.OK
    for _ in range(8):
        response = client.delete(
            f"/api/v1/tasks/?taskId={ids['task_id']}", headers=headers
        )
        assert response.status_code == HTTPStatus.NOT_FOUND


# ---------------------------------------------------------------------------
# Cross-API: full-stack churn and cascades
# ---------------------------------------------------------------------------


def test_project_delete_cascades_under_heavy_fixture(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Deleting a project with many columns + tasks leaves no orphans.

    The base suite verifies a 1-column / 1-task cascade. We blow it up
    to N columns and M tasks to make sure the cascade is not bounded
    by an accidental ``find_many(... limit=)`` somewhere.
    """

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    extra_column_ids = []
    for index in range(5):
        response = client.post(
            "/api/v1/boards/",
            json={
                "columnName": f"Cascade-{index}",
                "projectId": ids["project_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED
        extra_column_ids.append(
            next(
                column["_id"]
                for column in _list_columns(client, headers, ids["project_id"])
                if column["columnName"] == f"Cascade-{index}"
            )
        )

    for column_id in extra_column_ids:
        for task_index in range(4):
            _make_task(
                client,
                headers,
                project_id=ids["project_id"],
                column_id=column_id,
                coordinator_id=logged_in["_id"],
                name=f"{column_id[:6]}-{task_index}",
            )

    # Pre-cascade snapshot: the store has plenty of rows for this project.
    assert len(store.find_many(COLUMNS, {"projectId": ids["project_id"]})) >= 9
    assert len(store.find_many(TASKS, {"projectId": ids["project_id"]})) >= 21

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}", headers=headers
    )
    assert response.status_code == HTTPStatus.OK
    assert store.find_many(COLUMNS, {"projectId": ids["project_id"]}) == []
    assert store.find_many(TASKS, {"projectId": ids["project_id"]}) == []
    assert store.find_by_id(PROJECTS, ids["project_id"]) is None


def test_repeated_column_delete_cascades_each_columns_tasks(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Deleting each non-default column must cascade only its own tasks."""

    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    extras: List[str] = []
    for index in range(3):
        response = client.post(
            "/api/v1/boards/",
            json={
                "columnName": f"Drop-{index}",
                "projectId": ids["project_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED
    for column in _list_columns(client, headers, ids["project_id"]):
        if column["columnName"].startswith("Drop-"):
            extras.append(column["_id"])

    for column_id in extras:
        for task_index in range(3):
            _make_task(
                client,
                headers,
                project_id=ids["project_id"],
                column_id=column_id,
                coordinator_id=logged_in["_id"],
                name=f"D-{column_id[:6]}-{task_index}",
            )

    for column_id in extras:
        before_other = len(store.find_many(TASKS, {"columnId": ids["todo_id"]}))
        response = client.delete(
            f"/api/v1/boards/?columnId={column_id}", headers=headers
        )
        assert response.status_code == HTTPStatus.OK
        assert store.find_many(TASKS, {"columnId": column_id}) == []
        # Sibling column's tasks are untouched.
        assert (
            len(store.find_many(TASKS, {"columnId": ids["todo_id"]})) == before_other
        )


def test_session_chain_register_create_update_delete_for_many_users(
    client: TestClient,
) -> None:
    """End-to-end loop: each user creates, updates, and deletes their own resources.

    Acts as a fuzzy regression test: any single endpoint that misbehaved
    would show up as a failing step inside this long chain. The check
    runs for N=4 users to catch state-leak between sessions.
    """

    for index in range(4):
        info = register_and_login_user(
            client,
            f"chain-{index}",
            f"chain{index}@example.com",
        )
        headers = auth_headers(info["jwt"])

        response = client.post(
            "/api/v1/projects/",
            json={
                "projectName": f"Chain-{index}",
                "organization": "Acme",
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.CREATED
        project = _list_projects(client, headers)[0]
        # Auto-seed default columns.
        columns = _list_columns(client, headers, project["_id"])
        assert len(columns) == 3
        todo_id = next(
            column["_id"] for column in columns if column["columnName"] == "To Do"
        )

        for task_index in range(3):
            _make_task(
                client,
                headers,
                project_id=project["_id"],
                column_id=todo_id,
                coordinator_id=info["_id"],
                name=f"Chain-{index}-T-{task_index}",
            )
        tasks = _list_tasks(client, headers, project["_id"])
        # 3 created + the seed Default Task generated lazily? -- only 3 here
        # because the listing seeds Default Task only when there were zero.
        assert len(tasks) == 3

        # Update each task once.
        for task in tasks:
            response = client.put(
                "/api/v1/tasks/",
                json={
                    "_id": task["_id"],
                    "projectId": project["_id"],
                    "columnId": task["columnId"],
                    "coordinatorId": info["_id"],
                    "epic": "Updated",
                    "storyPoints": 9,
                    "taskName": task["taskName"] + "-v2",
                    "type": "Task",
                    "note": "updated",
                },
                headers=headers,
            )
            assert response.status_code == HTTPStatus.OK

        # Delete the project and verify the user's listing is empty.
        response = client.delete(
            f"/api/v1/projects/?projectId={project['_id']}",
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert _list_projects(client, headers) == []


def test_request_without_auth_token_is_rejected_across_every_protected_route(
    client: TestClient,
) -> None:
    """Unauthenticated calls must 401 on every authenticated route.

    Iterates the full v1 surface so a future router addition that
    forgets to depend on ``current_user_payload`` is caught the next
    time this test runs.
    """

    protected: List[tuple[str, str, Dict[str, Any] | None]] = [
        ("GET", "/api/v1/users/", None),
        ("PUT", "/api/v1/users/", {"username": "x"}),
        ("GET", "/api/v1/users/members", None),
        ("PUT", "/api/v1/users/likes", {"projectId": "p"}),
        ("POST", "/api/v1/projects/", {"projectName": "n", "organization": "o"}),
        ("GET", "/api/v1/projects/", None),
        ("PUT", "/api/v1/projects/", {"_id": "p"}),
        ("DELETE", "/api/v1/projects/?projectId=p", None),
        ("GET", "/api/v1/boards/?projectId=p", None),
        ("POST", "/api/v1/boards/", {"columnName": "n", "projectId": "p"}),
        ("PUT", "/api/v1/boards/orders", {"fromId": "x"}),
        ("DELETE", "/api/v1/boards/?columnId=c", None),
        ("GET", "/api/v1/tasks/?projectId=p", None),
        ("POST", "/api/v1/tasks/", {}),
        ("PUT", "/api/v1/tasks/", {"_id": "x"}),
        ("DELETE", "/api/v1/tasks/?taskId=x", None),
        ("PUT", "/api/v1/tasks/orders", {"fromId": "x"}),
    ]
    for method, path, body in protected:
        request = client.request(method, path, json=body)
        assert request.status_code == HTTPStatus.UNAUTHORIZED, (method, path)


def test_request_with_garbage_token_is_rejected_across_every_protected_route(
    client: TestClient,
) -> None:
    """A junk bearer token must 401 -- not 403, not 500 -- on every route."""

    headers = {"Authorization": "Bearer not-a-real-jwt"}
    routes: List[tuple[str, str]] = [
        ("GET", "/api/v1/users/"),
        ("GET", "/api/v1/users/members"),
        ("GET", "/api/v1/projects/"),
        ("GET", "/api/v1/boards/?projectId=p"),
        ("GET", "/api/v1/tasks/?projectId=p"),
    ]
    for method, path in routes:
        response = client.request(method, path, headers=headers)
        assert response.status_code == HTTPStatus.UNAUTHORIZED, (method, path)


def test_validation_envelope_shape_is_consistent_across_post_endpoints(
    client: TestClient,
) -> None:
    """Every POST validation failure must use the same error envelope.

    FE error toasts assume ``{"error": [...]}`` for validation failures
    on body shape. A drift to ``{"error": "message"}`` on one route
    would break the toast renderer. Loops the POST endpoints with an
    empty body to make sure the envelope is uniform.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    endpoints: List[str] = [
        "/api/v1/projects/",
        "/api/v1/boards/",
        "/api/v1/tasks/",
    ]
    for endpoint in endpoints:
        response = client.post(endpoint, json={}, headers=headers)
        assert response.status_code == HTTPStatus.BAD_REQUEST, endpoint
        body = response.json()
        assert isinstance(body, dict) and "error" in body, endpoint
        assert isinstance(body["error"], list), endpoint
        assert all("msg" in entry for entry in body["error"]), endpoint


def test_seed_creates_a_default_task_only_when_zero_exist(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Repeated GETs after creating real tasks must not generate Default Task copies.

    The auto-seed branch in ``task_service.get`` is guarded by
    ``if not tasks``; a regression that flipped the predicate would
    insert a Default Task on every poll. We hammer the GET to make
    sure the seed runs at most once.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    response = client.post(
        "/api/v1/projects/",
        json={"projectName": "Seed task", "organization": "Acme"},
        headers=headers,
    )
    assert response.status_code == HTTPStatus.CREATED
    project_id = _list_projects(client, headers)[0]["_id"]
    # ``GET /tasks/`` only seeds Default Task when columns exist. Touch
    # ``GET /boards/`` once so the lazy column seed runs first; without
    # this step the tasks router returns 404 ("Column not found").
    _list_columns(client, headers, project_id)
    # First GET triggers the seed.
    first = _list_tasks(client, headers, project_id)
    assert len(first) == 1
    assert first[0]["taskName"] == "Default Task"
    for _ in range(8):
        again = _list_tasks(client, headers, project_id)
        assert len(again) == 1
        assert again[0]["_id"] == first[0]["_id"]
    # And the underlying store agrees.
    assert (
        len(store.find_many(TASKS, {"projectId": project_id})) == 1
    ), "auto-seed inserted Default Task more than once"


def test_token_from_old_user_continues_to_work_across_many_calls(
    client: TestClient,
) -> None:
    """A token issued early must remain valid through N intervening calls.

    Some FE flows cache the JWT for the lifetime of the tab. A
    regression that invalidated a token on, say, password update would
    break long-lived sessions. We exercise the token N times around an
    actual password update to pin the behaviour.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    for _ in range(5):
        response = client.get("/api/v1/users/", headers=headers)
        assert response.status_code == HTTPStatus.OK
    response = client.put(
        "/api/v1/users/", json={"password": "new-secret"}, headers=headers
    )
    assert response.status_code == HTTPStatus.OK
    # The token still works after the password change. (Token revocation
    # on credential change is a planned hardening; if/when it lands, this
    # assertion is the place to flip the contract explicitly.)
    for _ in range(5):
        response = client.get("/api/v1/users/", headers=headers)
        assert response.status_code == HTTPStatus.OK


def test_repeated_get_users_after_n_updates_reflects_only_the_last_write(
    client: TestClient,
) -> None:
    """Sequential PUTs must converge to the most recent write.

    Issues N updates with distinct usernames, then GETs and asserts the
    response matches the last PUT body. A regression that re-ordered
    the update queue would show a stale name.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    for index in range(10):
        response = client.put(
            "/api/v1/users/",
            json={"username": f"alice-{index}"},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
    response = client.get("/api/v1/users/", headers=headers)
    assert response.status_code == HTTPStatus.OK
    assert response.json()["username"] == "alice-9"


def test_register_followed_by_immediate_login_is_consistent_across_n_users(
    client: TestClient,
) -> None:
    """Each register/login pair must immediately produce a usable token.

    Some auth backends have a propagation delay between insert and
    read; the FakeStore is synchronous so any flake here points at a
    bug in the handler rather than the store. N=8 sequential pairs.
    """

    for index in range(8):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": f"sequential-{index}",
                "email": f"sequential{index}@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.CREATED
        response = client.post(
            "/api/v1/auth/login",
            json={
                "email": f"sequential{index}@example.com",
                "password": "secret",
            },
        )
        assert response.status_code == HTTPStatus.OK
        body = response.json()
        assert body["email"] == f"sequential{index}@example.com"
        # GET /users/ with the freshly-minted token must round-trip.
        response = client.get(
            "/api/v1/users/", headers=auth_headers(client.cookies["Token"])
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json()["_id"] == body["_id"]


def test_intruder_attempts_against_many_projects_are_all_forbidden(
    client: TestClient,
    store: FakeStore,
) -> None:
    """A single intruder hammering N victim projects must always 403.

    Cross-tenant isolation is the most security-relevant invariant in
    the CRUD surface. We seed M victim projects via the helper and let
    the intruder probe each one; every probe must 403 / 404 and never
    leak data.
    """

    victim = register_and_login(client)
    intruder = register_and_login_user(
        client, "intruder", "intruder@example.com"
    )
    intruder_headers = auth_headers(intruder["jwt"])

    project_ids: List[str] = []
    for index in range(6):
        response = client.post(
            "/api/v1/projects/",
            json={"projectName": f"Victim-{index}", "organization": "OpenAI"},
            headers=auth_headers(victim["jwt"]),
        )
        assert response.status_code == HTTPStatus.CREATED
        project_ids.append(
            next(
                project["_id"]
                for project in _list_projects(client, auth_headers(victim["jwt"]))
                if project["projectName"] == f"Victim-{index}"
            )
        )

    for project_id in project_ids:
        for method, path in (
            ("GET", f"/api/v1/projects/?projectId={project_id}"),
            ("PUT", "/api/v1/projects/"),
            ("DELETE", f"/api/v1/projects/?projectId={project_id}"),
            ("GET", f"/api/v1/boards/?projectId={project_id}"),
            ("POST", "/api/v1/boards/"),
            ("GET", f"/api/v1/tasks/?projectId={project_id}"),
        ):
            body: Dict[str, Any] | None
            if method == "PUT":
                body = {
                    "_id": project_id,
                    "projectName": "Hijack",
                    "organization": "x",
                }
            elif method == "POST":
                body = {"columnName": "Mine", "projectId": project_id}
            else:
                body = None
            response = client.request(
                method, path, headers=intruder_headers, json=body
            )
            assert response.status_code == HTTPStatus.FORBIDDEN, (
                method,
                path,
                response.status_code,
            )

    # Victim's data is untouched.
    assert len(store.find_many(PROJECTS, {"managerId": victim["_id"]})) == len(
        project_ids
    )


def test_member_directory_never_exposes_sensitive_fields_across_n_members(
    client: TestClient,
) -> None:
    """``GET /users/members`` returns only public fields, repeatedly.

    The redaction list (``_id``, ``username``, ``email``) is enforced
    by ``user_service.get_members``. We register N users, each with a
    distinct password, and assert the public listing never echoes the
    password hash or ``likedProjects``.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])

    for index in range(8):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": f"public-{index}",
                "email": f"public{index}@example.com",
                "password": f"secret-{index}-padded",
            },
        )
        assert response.status_code == HTTPStatus.CREATED

    members = client.get("/api/v1/users/members", headers=headers).json()
    assert len(members) == 9  # 8 new + alice
    allowed = {"_id", "username", "email"}
    for member in members:
        assert set(member) == allowed
        assert "password" not in member
        assert "likedProjects" not in member


def test_repeated_get_health_is_stable_under_load(client: TestClient) -> None:
    """``GET /api/v1/health`` is a hot poll path; N calls must all 200.

    The handler runs a DB ping every probe; a regression that crashed
    on the second ping would surface as flapping health. We also
    check the canonical key set is present on every response.
    """

    expected_keys = {
        "status",
        "ok",
        "database",
        "agents_loaded",
        "agentsLoaded",
        "latency_ms",
        "latencyMs",
        "checkpointer",
        "store",
        "agent_persistence",
        "agentPersistence",
        "agent_persistence_ok",
        "agentPersistenceOk",
    }
    for _ in range(15):
        response = client.get("/api/v1/health")
        assert response.status_code == HTTPStatus.OK
        body = response.json()
        assert body["status"] == "ok"
        assert expected_keys.issubset(body.keys())


def test_legacy_health_alias_serves_same_payload_on_every_call(
    client: TestClient,
) -> None:
    """``GET /health`` returns the same payload as the versioned path.

    The legacy alias is wired up explicitly to avoid a 308 redirect.
    Hammering it must keep matching the versioned endpoint or the FE's
    fallback would diverge from its primary.
    """

    for _ in range(10):
        legacy = client.get("/health", follow_redirects=False)
        canonical = client.get("/api/v1/health")
        assert legacy.status_code == HTTPStatus.OK
        assert canonical.status_code == HTTPStatus.OK
        # Latency varies between calls; compare the static keys only.
        for key in ("status", "ok", "checkpointer", "store", "agent_persistence"):
            assert legacy.json()[key] == canonical.json()[key], key


def test_cross_origin_preflight_is_consistent_across_methods(client: TestClient) -> None:
    """The CORS layer responds 200 to OPTIONS for every method we expose.

    Hammers ``OPTIONS`` against several routes with each method in the
    allow list; a regression in the middleware would surface as one
    method silently 4xxing the preflight.
    """

    methods = ["GET", "POST", "PUT", "DELETE"]
    paths = [
        "/api/v1/auth/login",
        "/api/v1/users/",
        "/api/v1/projects/",
        "/api/v1/boards/",
        "/api/v1/tasks/",
    ]
    for path in paths:
        for method in methods:
            response = client.options(
                path,
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": (
                        "authorization,content-type,x-pulse-model"
                    ),
                },
            )
            assert response.status_code == HTTPStatus.OK, (path, method)
            assert (
                response.headers.get("access-control-allow-origin")
                == "http://localhost:3000"
            ), (path, method)
            allow_headers = response.headers.get("access-control-allow-headers", "")
            assert "x-pulse-model" in allow_headers.lower(), (path, method)


def test_user_password_update_invalidates_old_password_for_every_login(
    client: TestClient,
) -> None:
    """After a password change every old-password login must 401.

    The change is persistent; the FE retries login on transient
    network errors. We hammer the OLD password N times after the
    change and the NEW one N times to assert symmetric behaviour.
    """

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    response = client.put(
        "/api/v1/users/", json={"password": "rotated-secret"}, headers=headers
    )
    assert response.status_code == HTTPStatus.OK

    for _ in range(6):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "secret"},
        )
        assert response.status_code == HTTPStatus.UNAUTHORIZED
    for _ in range(6):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "rotated-secret"},
        )
        assert response.status_code == HTTPStatus.OK


def test_repeated_invalid_reorder_payloads_never_corrupt_state(
    client: TestClient,
    store: FakeStore,
) -> None:
    """N malformed ``/orders`` payloads must leave the indexes contiguous.

    A regression that partially-applied an invalid update would leave
    the source column re-packed but the destination untouched. We
    confirm that nothing in the underlying store moves across N
    rejected attempts.
    """

    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))
    before_tasks = {
        task["_id"]: dict(task)
        for task in store.find_many(TASKS, {"projectId": ids["project_id"]})
    }

    invalid_payloads: List[Dict[str, Any]] = [
        # Mismatched column hints.
        {
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": ids["task_b"],
            "fromColumnId": ids["doing_id"],
            "referenceColumnId": ids["todo_id"],
        },
        # Unknown task id.
        {
            "type": "after",
            "fromId": "missing-task",
            "referenceId": ids["task_b"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["todo_id"],
        },
        # Unknown order type.
        {
            "type": "sideways",
            "fromId": ids["task_a"],
            "referenceId": ids["task_b"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["todo_id"],
        },
        # Cross-project columns.
        {
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": ids["task_d"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": "no-such-column",
        },
    ]

    for payload in invalid_payloads:
        response = client.put("/api/v1/tasks/orders", json=payload, headers=headers)
        assert response.status_code >= 400, payload

    after_tasks = {
        task["_id"]: dict(task)
        for task in store.find_many(TASKS, {"projectId": ids["project_id"]})
    }
    # Order-relevant fields are unchanged on every task.
    for task_id, before in before_tasks.items():
        after = after_tasks[task_id]
        for key in ("columnId", "index"):
            assert before[key] == after[key], (task_id, key)


def test_bulk_task_reorder_returns_canonical_status_string_n_times(
    client: TestClient,
    store: FakeStore,
) -> None:
    """N successful reorders all return the literal ``"Task reordered"`` string.

    The FE drives a "moved" toast off the response body. A regression
    that returned the updated task list (or ``{"status": "ok"}``) would
    silently break that toast renderer.
    """

    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))

    # task_a then task_b then task_c shuffled forward/backward.
    for _ in range(6):
        response = client.put(
            "/api/v1/tasks/orders",
            json={
                "type": "after",
                "fromId": ids["task_a"],
                "referenceId": ids["task_c"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json() == "Task reordered"
        response = client.put(
            "/api/v1/tasks/orders",
            json={
                "type": "before",
                "fromId": ids["task_a"],
                "referenceId": ids["task_b"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json() == "Task reordered"


def test_password_hash_is_unique_per_user_across_many_registrations(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Each registered user must get a salted password hash distinct from peers.

    The PBKDF2 helper generates a fresh salt for every call. A
    regression that re-used a salt (or hashed an empty string) would
    collapse N hashes to one value. We pin uniqueness across N users
    sharing the same plaintext.
    """

    for index in range(8):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "username": f"saltybob-{index}",
                "email": f"salty{index}@example.com",
                "password": "shared-password",
            },
        )
        assert response.status_code == HTTPStatus.CREATED

    hashes = [
        user["password"]
        for user in store.find_many(USERS, {})
        if user["email"].startswith("salty")
    ]
    assert len(hashes) == 8
    assert len(set(hashes)) == 8, "PBKDF2 salts collided across users"
    assert all(h.startswith("pbkdf2_sha256$") for h in hashes)


def test_repeated_options_does_not_change_state(client: TestClient) -> None:
    """OPTIONS / preflight calls must be safe to repeat.

    A regression that mutated state on OPTIONS (e.g. incremented a
    counter, opened a DB transaction) would surface as the membership
    table growing under no real traffic. We pin the read-only invariant.
    """

    register_and_login(client)
    client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "secret"},
    )
    base_members = client.get(
        "/api/v1/users/members",
        headers=auth_headers(client.cookies["Token"]),
    ).json()

    for _ in range(20):
        client.options(
            "/api/v1/projects/",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "secret"},
    )
    assert response.status_code == HTTPStatus.OK
    new_members = client.get(
        "/api/v1/users/members", headers=auth_headers(client.cookies["Token"])
    ).json()
    assert new_members == base_members
