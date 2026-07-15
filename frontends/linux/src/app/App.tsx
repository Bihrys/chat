import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function App() {
  const [backend, setBackend] = useState("checking");

  useEffect(() => {
    void invoke<string>("backend_status")
      .then(setBackend)
      .catch(() => setBackend("unavailable"));
  }, []);

  return (
    <main className="app-shell">
      <section className="status-card">
        <p className="eyebrow">Secure Chat</p>
        <h1>Desktop development shell is ready.</h1>
        <p>Shared Rust backend: <strong>{backend}</strong></p>
      </section>
    </main>
  );
}
