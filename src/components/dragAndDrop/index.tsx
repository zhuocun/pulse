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
    DraggableProvidedDraggableProps,
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

type DropCloneProps = Partial<DroppableProvidedProps> &
    RefAttributes<HTMLElement> & {
        provided?: DroppableProvided;
    };

type DragCloneProps = Partial<DraggableProvidedDraggableProps> &
    Partial<DraggableProvidedDragHandleProps> &
    RefAttributes<HTMLElement> & {
        "data-dragging"?: string;
    };

type DropProps = Omit<DroppableProps, "children"> & { children: ReactNode };

export const Drop = ({ children, ...props }: DropProps) => {
    return (
        <Droppable {...props}>
            {(provided) => {
                if (React.isValidElement(children)) {
                    return React.cloneElement(
                        children as React.ReactElement<DropCloneProps>,
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
                    const base: DragCloneProps = {
                        ...provided.draggableProps,
                        "data-dragging": isDragging ? "true" : undefined,
                        ref: provided.innerRef,
                        ...(detachDragHandle
                            ? {}
                            : (provided.dragHandleProps ?? {}))
                    };

                    const cloned = React.cloneElement(
                        children as React.ReactElement<DragCloneProps>,
                        base
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
