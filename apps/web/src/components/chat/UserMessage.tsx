import React from "react";
import { useMessage } from "@assistant-ui/react";

export function UserMessage() {
  const message = useMessage();
  const text =
    message.content
      .filter((part) => part.type === "text")
      .map((part) => (part as { type: "text"; text: string }).text)
      .join("") ?? "";

  return (
    <div className="chat-user-prompt">
      <p className="chat-user-prompt__text">{text}</p>
    </div>
  );
}
