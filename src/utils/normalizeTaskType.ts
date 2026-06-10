/**
 * Canonical task-type vocabulary. The wire shape (`ITask.type`) is an
 * open string, so imported / legacy data can carry out-of-vocabulary
 * values like "feature". Every display surface (board card, modal
 * title tag, type select) must agree on how such a value reads —
 * without one normalizer the card coerced to "Task" while the form
 * select leaked the raw string. Anything that isn't exactly "Bug"
 * renders as "Task".
 */
export type CanonicalTaskType = "Task" | "Bug";

const normalizeTaskType = (type: string | undefined): CanonicalTaskType =>
    type === "Bug" ? "Bug" : "Task";

export default normalizeTaskType;
