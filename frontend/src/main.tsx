import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { RemoteGuest } from "./components/RemoteGuest";
import { httpsUpgradeUrl } from "./browserRouting";
import "./styles.css";

const secureUrl = httpsUpgradeUrl(window.location);

if (secureUrl) {
  window.location.replace(secureUrl);
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {new URLSearchParams(window.location.search).get("contribute") === "1" ? <RemoteGuest /> : <App />}
    </React.StrictMode>,
  );
}
