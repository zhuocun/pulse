import React, {
    ReactNode,
    RefAttributes,
    createContext,
    useContext
} from "react";
import {
    Draggable,
    DraggableProps,
    DraggableProvidedDragHandleProps,
    Droppable,
    DroppableProps,
    DroppableProvided,
    DroppableProvidedProps
} from "@hello-pangea/dnd";

const DetachedDragHandleContext = createContext<
    DraggableProvidedDragHandleProps | null | undefined
>(undefined);

export const useDetachedDragHandleProps = () =>
    useContext(DetachedDragHandleContext);

type DropProps = Omit<DroppableProps, "children"> & { children: ReactNode };

export const Drop = ({ children, ...props }: DropProps) => {
    return (
        <Droppable {...props}>
            {(provided) => {
                if (React.isValidElement(children)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return React.cloneElement<RefAttributes<unknown> | any>(
                        children,
                        {
                            ...provided.droppableProps,
                            ref: provided.innerRef,
                            provided
                        }
                    );
                }
                return <div />;
            }}
        </Droppable>
    );
};

type DropChildProps = Partial<
    { provided: DroppableProvided } & DroppableProvidedProps
> &
    React.HTMLAttributes<HTMLDivElement>;

export const DropChild = React.forwardRef<HTMLDivElement, DropChildProps>(
    ({ children, ...props }, ref) => (
        <div ref={ref} {...props}>
            {children}
            {props.provided?.placeholder}
        </div>
    )
);

DropChild.displayName = "Drop Child";

type DragProps = Omit<DraggableProps, "children"> & {
    children: ReactNode;
    /** When true, only `draggableProps` + ref go on the child; spread `dragHandleProps` from `useDetachedDragHandleProps()` on a descendant handle. */
    detachDragHandle?: boolean;
};
export const Drag = ({
    children,
    detachDragHandle = false,
    ...props
}: DragProps) => {
    return (
        <Draggable {...props}>
            {(provided, rbdSnapshot) => {
                if (React.isValidElement(children)) {
                    const isDragging = Boolean(rbdSnapshot?.isDragging);
                    const base: Record<string, unknown> = {
                        ...provided.draggableProps,
                        "data-dragging": isDragging ? "true" : undefined,
                        ref: provided.innerRef
                    };
                    if (!detachDragHandle) {
                        Object.assign(
                            base,
                            provided.dragHandleProps ?? undefined
                        );
                    }

                    const cloned = React.cloneElement(
                        children,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RBD cloneElement loses child ref/prop precision
                        base as any
                    );

                    if (detachDragHandle) {
                        return (
                            <DetachedDragHandleContext.Provider
                                value={provided.dragHandleProps}
                            >
                                {cloned}
                            </DetachedDragHandleContext.Provider>
                        );
                    }
                    return cloned;
                }
                return <div />;
            }}
        </Draggable>
    );
};
