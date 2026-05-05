from app.domain.ordering import column_reorder_updates, task_reorder_updates


def test_column_reorder_updates_are_pure_domain_plans() -> None:
    columns = [
        {"_id": "todo", "index": 0},
        {"_id": "doing", "index": 1},
        {"_id": "done", "index": 2},
    ]

    updates = column_reorder_updates("before", columns[2], columns[0], columns)

    assert [(update.item_id, update.changes) for update in updates] == [
        ("doing", {"index": 2}),
        ("done", {"index": 0}),
        ("todo", {"index": 1}),
    ]
    assert column_reorder_updates("sideways", columns[2], columns[0], columns) is None


def test_task_reorder_cross_column_append_and_invalid_same_column() -> None:
    from_task = {"_id": "a", "index": 0}
    sibling_task = {"_id": "b", "index": 1}
    reference_tasks = [{"_id": "c", "index": 0}]

    updates = task_reorder_updates(
        "after",
        "todo",
        "done",
        from_task,
        None,
        [from_task, sibling_task],
        reference_tasks,
    )

    assert [(update.item_id, update.changes) for update in updates] == [
        ("b", {"index": 0}),
        ("a", {"columnId": "done", "index": 1}),
    ]
    assert (
        task_reorder_updates(
            "after",
            "todo",
            "todo",
            from_task,
            None,
            [from_task, sibling_task],
            [from_task, sibling_task],
        )
        is None
    )
    assert (
        task_reorder_updates(
            "sideways",
            "todo",
            "todo",
            from_task,
            sibling_task,
            [from_task, sibling_task],
            [from_task, sibling_task],
        )
        is None
    )
