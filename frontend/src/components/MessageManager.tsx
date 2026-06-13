import { type FormEvent, useEffect, useState } from "react";

import {
  createMessage,
  createMessageThread,
  deleteMessageThread,
  getMembers,
  getMessageThread,
  getMessageThreads,
  type Member,
  type MessageThread,
  type MessageThreadDetail,
} from "../api";
import { useConfirmationDialog } from "./ConfirmationDialog";

export function MessageManager({ canWrite }: { canWrite: boolean }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [thread, setThread] = useState<MessageThreadDetail | null>(null);
  const [users, setUsers] = useState<Member[]>([]);
  const [mode, setMode] = useState<"read" | "create">("read");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load(selectedThreadId?: string | null) {
    setMessage(null);

    try {
      const [nextThreads, nextUsers] = await Promise.all([getMessageThreads(), getMembers()]);
      setThreads(nextThreads);
      setUsers(nextUsers.filter((user) => user.active));
      const targetId =
        selectedThreadId === null
          ? nextThreads[0]?.id
          : selectedThreadId ?? thread?.id ?? nextThreads[0]?.id;
      setThread(targetId ? await getMessageThread(targetId) : null);
      setCreatorId((current) => current || nextUsers[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load messages.");
    }
  }

  function startCreate() {
    if (!canWrite) {
      return;
    }
    setMode("create");
    setThread(null);
    setSubject("");
    setBody("");
    setParticipantIds([]);
  }

  function toggleParticipant(userId: string) {
    setParticipantIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function selectThread(threadId: string) {
    setMode("read");
    setThread(await getMessageThread(threadId));
  }

  async function submitThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite) {
      setMessage("You can read messages, but only members with write access can send them.");
      return;
    }
    setMessage(null);

    try {
      const saved = await createMessageThread({
        subject,
        creator_id: creatorId || null,
        participant_ids: participantIds,
        body,
      });
      setMode("read");
      await load(saved.id);
      setMessage("Message thread created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create message.");
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread || !canWrite) {
      return;
    }

    try {
      await createMessage(thread.id, { sender_id: creatorId || null, body: reply });
      setReply("");
      await load(thread.id);
      setMessage("Reply sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send reply.");
    }
  }

  async function removeThread() {
    if (!thread || !canWrite) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Delete",
      message: `Delete message thread "${thread.subject}"?`,
      title: "Delete Message Thread",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteMessageThread(thread.id);
      await load(null);
      setMessage("Message thread deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete thread.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Messages">
      {confirmationDialog}
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Messages</h2>
          <button className="text-button" disabled={!canWrite} onClick={startCreate} type="button">
            New Message
          </button>
        </div>

        <div className="stack-list">
          {threads.map((item) => (
            <button
              className={`stack-row ${item.id === thread?.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => void selectThread(item.id)}
              type="button"
            >
              <strong>{item.subject}</strong>
              <span>
                {item.message_count} messages · {item.creator_name ?? "system"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {mode === "create" ? (
        <form className="editor-panel" onSubmit={(event) => void submitThread(event)}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Create</p>
              <h2>New Message</h2>
            </div>
          <button className="primary-button" disabled={!canWrite} type="submit">
            Send
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        {!canWrite ? (
          <p className="empty-state">You can read message threads here, but only members with write access can send new messages.</p>
        ) : null}

          <div className="form-grid">
            <label>
              From
              <select disabled={!canWrite} onChange={(event) => setCreatorId(event.target.value)} value={creatorId}>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Subject
              <input disabled={!canWrite} onChange={(event) => setSubject(event.target.value)} required value={subject} />
            </label>

            <fieldset className="wide-field role-fieldset">
              <legend>Participants</legend>
              <div className="role-grid">
                {users.map((user) => (
                  <label key={user.id}>
                    <input
                      disabled={!canWrite}
                      checked={participantIds.includes(user.id)}
                      onChange={() => toggleParticipant(user.id)}
                      type="checkbox"
                    />
                    {user.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="wide-field">
              Message
              <textarea
                disabled={!canWrite}
                onChange={(event) => setBody(event.target.value)}
                required
                rows={8}
                value={body}
              />
            </label>
          </div>
        </form>
      ) : (
        <div className="editor-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Thread</p>
              <h2>{thread?.subject ?? "Messages"}</h2>
            </div>
            {thread && canWrite ? (
              <button className="danger-button" onClick={() => void removeThread()} type="button">
                Delete Thread
              </button>
            ) : null}
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <div className="message-timeline">
            {(thread?.messages ?? []).map((item) => (
              <article className="message-bubble" key={item.id}>
                <strong>{item.sender_name ?? "System"}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>

          {thread ? (
            <form className="sub-editor reply-form" onSubmit={(event) => void submitReply(event)}>
              {!canWrite ? <p className="empty-state">Replies are read-only for your role.</p> : null}
              <label>
                Reply
                <textarea
                  disabled={!canWrite}
                  onChange={(event) => setReply(event.target.value)}
                  required
                  rows={4}
                  value={reply}
                />
              </label>
              <div className="action-row form-actions">
                <button className="primary-button" disabled={!canWrite} type="submit">
                  Send Reply
                </button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}
