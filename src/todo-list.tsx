import { LaunchProps } from "@raycast/api";
import { TodoList } from "./ui/TodoList";

export default function TodoListCommand(props: LaunchProps) {
  return <TodoList initialText={props.fallbackText} />;
}
