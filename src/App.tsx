import { useState } from "react";
import { TelegramChatsManager } from "./TelegramChatsManager";

const ADMIN_KEY_STORAGE = "adminKey";

/**
 * Top-level gate: the entire admin surface is authorised by a single ADMIN_KEY
 * string (constant-time compared server-side). We keep it in localStorage so a
 * reload doesn't re-prompt. This is a deliberately simple starter auth model —
 * swap for a real session token when wiring into an app with users (see
 * SECURITY.md in the repo root).
 */
export default function App() {
  const [adminKey, setAdminKey] = useState<string | null>(() =>
    localStorage.getItem(ADMIN_KEY_STORAGE),
  );

  function saveKey(key: string) {
    localStorage.setItem(ADMIN_KEY_STORAGE, key);
    setAdminKey(key);
  }

  function forgetKey() {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    setAdminKey(null);
  }

  if (!adminKey) {
    return <AdminKeyGate onSave={saveKey} />;
  }

  return (
    <div className="container">
      <header className="page-header">
        <h1>Telegram Chats</h1>
        <button className="btn btn-ghost" onClick={forgetKey}>
          Forget key
        </button>
      </header>
      <TelegramChatsManager adminKey={adminKey} onForgetKey={forgetKey} />
    </div>
  );
}

/** Centered card prompting for the admin key on first visit. */
function AdminKeyGate({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSave(trimmed);
  }

  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <h1>Admin access</h1>
        <p className="muted">
          Enter the <code>ADMIN_KEY</code> configured on your Convex deployment.
        </p>
        <input
          type="password"
          className="input"
          placeholder="Admin key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
          Save
        </button>
      </form>
    </div>
  );
}
