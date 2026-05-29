import { useState, Component, type ReactNode } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { KNOWN_TELEGRAM_ROLES, TELEGRAM_BOT_USERNAME } from "../convex/telegram/config";
import { formatRelative } from "./relativeTime";

type Chat = Doc<"telegramChats">;

const NONE_OPTION = "(none)";

/** Pull a human-readable message out of an unknown thrown value. */
function errorMessage(err: unknown): string {
  // ConvexError carries the thrown payload on `.data` (a string for our backend).
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : String(err.data);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function TelegramChatsManager({
  adminKey,
  onForgetKey,
}: {
  adminKey: string;
  onForgetKey: () => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);

  // skip the subscription until we have a key (we always do here, but the
  // pattern keeps the hook honest if the gate ever changes). An invalid key
  // makes the query THROW server-side; useQuery surfaces that as a thrown
  // render error, which we cannot try/catch around a hook — so instead we
  // detect "no data + key present" can't distinguish, and rely on the backend
  // returning data for a valid key. To show a friendly invalid-key message we
  // wrap the table render in a try via the error boundary below.
  const chats = useQuery(api.telegram.chatRegistry.adminListChats, {
    adminKey,
    includeArchived,
  });

  return (
    <div>
      <div className="toolbar">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <ChatsTableBoundary onForgetKey={onForgetKey}>
        {chats === undefined ? (
          <p className="muted">Loading chats…</p>
        ) : chats.length === 0 ? (
          <p className="muted">
            No chats registered yet. Add the bot to a Telegram group and send{" "}
            <code>/register@{TELEGRAM_BOT_USERNAME}</code> there.
          </p>
        ) : (
          <ChatsTable adminKey={adminKey} chats={chats} />
        )}
      </ChatsTableBoundary>
    </div>
  );
}

// ─── error boundary (invalid key / backend error) ─────────────────────────────

/**
 * useQuery throws synchronously during render when the backend rejects (e.g. an
 * invalid admin key). Hooks can't be wrapped in try/catch, so a class error
 * boundary is the idiomatic way to turn that into a friendly message.
 */
class ChatsTableBoundary extends Component<
  { children: ReactNode; onForgetKey: () => void },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card error-card">
          <strong>Invalid admin key or backend error.</strong>
          <p className="muted">{errorMessage(this.state.error)}</p>
          <button className="btn btn-ghost" onClick={this.props.onForgetKey}>
            Forget key
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── table ─────────────────────────────────────────────────────────────────

function ChatsTable({ adminKey, chats }: { adminKey: string; chats: Chat[] }) {
  const noRoles = KNOWN_TELEGRAM_ROLES.length === 0;

  return (
    <>
      {noRoles && (
        <p className="note">
          No roles defined yet — add them to{" "}
          <code>convex/telegram/config.ts</code> (
          <code>KNOWN_TELEGRAM_ROLES</code>).
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Chat ID</th>
              <th>Role</th>
              <th>Last seen</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {chats.map((chat) => (
              <ChatRow key={chat._id} adminKey={adminKey} chat={chat} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

type StatusKind = "archived" | "error" | "active" | "dormant";

function deriveStatus(chat: Chat): { kind: StatusKind; label: string; title?: string } {
  if (chat.archivedAt !== undefined) {
    return { kind: "archived", label: "Archived" };
  }
  if (chat.lastError && Date.now() - chat.lastError.at < DAY_MS) {
    return { kind: "error", label: "Error", title: chat.lastError.message };
  }
  if (chat.role) {
    return { kind: "active", label: "Active" };
  }
  return { kind: "dormant", label: "Dormant (no role)" };
}

function ChatRow({ adminKey, chat }: { adminKey: string; chat: Chat }) {
  const assignRole = useMutation(api.telegram.chatRegistry.adminAssignRole);
  const archiveChat = useMutation(api.telegram.chatRegistry.adminArchiveChat);
  const restoreChat = useMutation(api.telegram.chatRegistry.adminRestoreChat);
  const sendTest = useAction(api.telegram.chatRegistry.adminSendTest);

  const [busy, setBusy] = useState(false);
  // Inline per-row feedback (no toast lib): { ok, text }.
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const status = deriveStatus(chat);
  const archived = chat.archivedAt !== undefined;

  async function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    const role = selected === NONE_OPTION ? null : selected;
    setBusy(true);
    setMessage(null);
    try {
      await assignRole({ adminKey, chatId: chat.chatId, role });
      setMessage({ ok: true, text: role ? `Role set to ${role}` : "Role cleared" });
    } catch (err) {
      const msg = errorMessage(err);
      // Retry path 1: role is held by another chat → offer to steal it.
      if (msg.includes("already held by chat")) {
        if (confirm("Reassign role from the other chat?")) {
          try {
            await assignRole({ adminKey, chatId: chat.chatId, role, forceReassign: true });
            setMessage({ ok: true, text: `Reassigned role ${role}` });
          } catch (err2) {
            setMessage({ ok: false, text: errorMessage(err2) });
          }
        }
        // Retry path 2: target chat is archived → offer to restore + assign.
      } else if (msg.includes("archived")) {
        if (confirm("Restore this chat and assign the role?")) {
          try {
            await assignRole({ adminKey, chatId: chat.chatId, role, restoreIfArchived: true });
            setMessage({ ok: true, text: `Restored and assigned role ${role}` });
          } catch (err2) {
            setMessage({ ok: false, text: errorMessage(err2) });
          }
        }
      } else {
        setMessage({ ok: false, text: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTest() {
    if (!confirm("Send a test message to this chat?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await sendTest({ adminKey, chatId: chat.chatId });
      setMessage({ ok: true, text: "Test sent ✓" });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!confirm("Archive this chat? It will stop receiving messages.")) return;
    setBusy(true);
    setMessage(null);
    try {
      await archiveChat({ adminKey, chatId: chat.chatId });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!confirm("Restore this chat?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await restoreChat({ adminKey, chatId: chat.chatId });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={archived ? "row-archived" : undefined}>
      <td>{chat.title}</td>
      <td>{chat.chatType}</td>
      <td className="mono">{chat.chatId}</td>
      <td>
        <select
          className="input select"
          value={chat.role ?? NONE_OPTION}
          onChange={handleRoleChange}
          disabled={busy}
        >
          <option value={NONE_OPTION}>{NONE_OPTION}</option>
          {KNOWN_TELEGRAM_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
          {/* Preserve an out-of-allowlist role so it shows rather than silently
              reverting to (none); selecting another value reassigns it. */}
          {chat.role && !(KNOWN_TELEGRAM_ROLES as readonly string[]).includes(chat.role) && (
            <option value={chat.role}>{chat.role} (unknown)</option>
          )}
        </select>
      </td>
      <td title={new Date(chat.lastSeenAt).toLocaleString()}>
        {formatRelative(chat.lastSeenAt)}
      </td>
      <td>
        <span className={`badge badge-${status.kind}`} title={status.title}>
          {status.label}
        </span>
      </td>
      <td>
        <div className="actions">
          <button className="btn btn-sm" onClick={handleSendTest} disabled={busy}>
            {busy ? "…" : "Send test"}
          </button>
          {archived ? (
            <button className="btn btn-sm" onClick={handleRestore} disabled={busy}>
              Restore
            </button>
          ) : (
            <button className="btn btn-sm" onClick={handleArchive} disabled={busy}>
              Archive
            </button>
          )}
        </div>
        {message && (
          <div className={message.ok ? "inline-ok" : "inline-err"}>{message.text}</div>
        )}
      </td>
    </tr>
  );
}
