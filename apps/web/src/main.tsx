import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/themes/shadcn-extras.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
