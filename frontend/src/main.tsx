import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { httpsUpgradeUrl } from "./browserRouting";
import "./styles.css";

const secureUrl = httpsUpgradeUrl(window.location);

if (secureUrl) {
  window.location.replace(secureUrl);
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
