import { Drawer, Grid, Space } from "antd";

import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import AiSparkleIcon from "../aiSparkleIcon";
import BriefTabBody from "../copilotDock/BriefTabBody";

interface BoardBriefDrawerProps {
    open: boolean;
    onClose: () => void;
    project?: IProject;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
}

const BoardBriefDrawer: React.FC<BoardBriefDrawerProps> = ({
    open,
    onClose,
    project,
    columns,
    tasks,
    members
}) => {
    const screens = Grid.useBreakpoint();
    const drawerWidth = screens.md ? 420 : "100%";

    return (
        <Drawer
            onClose={onClose}
            open={open}
            styles={{
                body: {
                    paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`
                }
            }}
            title={
                <Space align="center" size={space.xs} wrap>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: 600 }}>
                        {microcopy.brief.title}
                    </span>
                </Space>
            }
            size={drawerWidth}
        >
            <BriefTabBody
                columns={columns}
                dockOpen={open}
                members={members}
                project={project}
                tasks={tasks}
            />
        </Drawer>
    );
};

export default BoardBriefDrawer;
