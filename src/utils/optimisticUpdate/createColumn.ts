const newColumnCallback = (
    target: {
        columnName: string;
        projectId: string;
    },
    old: IColumn[] | undefined
) => {
    const columns = old ?? [];
    return columns.concat({ ...target, index: columns.length, _id: "mock" });
};

export default newColumnCallback;
