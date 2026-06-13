import { type FormEvent, useEffect, useState } from "react";

import {
  createTeamAssignment,
  deleteTeamAssignment,
  getInstruments,
  getMembers,
  getPlans,
  getTeamAssignments,
  updateTeamAssignment,
  type Instrument,
  type Member,
  type PlanSummary,
  type TeamAssignment,
  type TeamAssignmentPayload,
} from "../api";
import { useConfirmationDialog } from "./ConfirmationDialog";

interface TeamFormState {
  user_id: string;
  role_label: string;
  instrument_id: string;
  status: string;
  notes: string;
}

function blankTeamForm(): TeamFormState {
  return {
    user_id: "",
    role_label: "Worship",
    instrument_id: "",
    status: "invited",
    notes: "",
  };
}

function formFromAssignment(assignment: TeamAssignment): TeamFormState {
  return {
    user_id: assignment.user_id ?? "",
    role_label: assignment.role_label,
    instrument_id: assignment.instrument_id ?? "",
    status: assignment.status,
    notes: assignment.notes ?? "",
  };
}

function payloadFromForm(planId: string, form: TeamFormState): TeamAssignmentPayload {
  return {
    plan_id: planId,
    user_id: form.user_id || null,
    role_label: form.role_label,
    instrument_id: form.instrument_id || null,
    status: form.status,
    notes: form.notes || null,
  };
}

export function TeamManager({ canEdit }: { canEdit: boolean }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [users, setUsers] = useState<Member[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<TeamAssignment | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("create");
  const [form, setForm] = useState<TeamFormState>(blankTeamForm());
  const [message, setMessage] = useState<string | null>(null);

  async function load(planId?: string) {
    setMessage(null);

    try {
      const [nextPlans, nextUsers, nextInstruments] = await Promise.all([
        getPlans(),
        getMembers(),
        getInstruments(),
      ]);
      const activeUsers = nextUsers.filter((user) => user.active);
      const targetPlanId = planId || selectedPlanId || nextPlans[0]?.id || "";
      setPlans(nextPlans);
      setUsers(activeUsers);
      setInstruments(nextInstruments);
      setSelectedPlanId(targetPlanId);
      setForm((current) => ({
        ...current,
        user_id: current.user_id || activeUsers[0]?.id || "",
        instrument_id: current.instrument_id || nextInstruments[0]?.id || "",
      }));

      if (targetPlanId) {
        setAssignments(await getTeamAssignments(targetPlanId));
      } else {
        setAssignments([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load team data.");
    }
  }

  function startCreate() {
    if (!canEdit) {
      return;
    }
    setSelectedAssignment(null);
    setMode("create");
    setForm({
      ...blankTeamForm(),
      user_id: users[0]?.id ?? "",
      instrument_id: instruments[0]?.id ?? "",
    });
  }

  function selectAssignment(assignment: TeamAssignment) {
    setSelectedAssignment(assignment);
    setMode("edit");
    setForm(formFromAssignment(assignment));
  }

  async function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    setSelectedAssignment(null);
    setMode("create");
    setForm({
      ...blankTeamForm(),
      user_id: users[0]?.id ?? "",
      instrument_id: instruments[0]?.id ?? "",
    });
    await load(planId);
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setMessage("You can view team assignments, but only service leaders and worship leaders can change them.");
      return;
    }
    if (!selectedPlanId) {
      setMessage("Select a plan first.");
      return;
    }

    setMessage(null);

    try {
      const payload = payloadFromForm(selectedPlanId, form);
      const saved =
        mode === "create"
          ? await createTeamAssignment(selectedPlanId, payload)
          : await updateTeamAssignment(selectedAssignment!.id, payload);
      await load(selectedPlanId);
      setSelectedAssignment(saved);
      setForm(formFromAssignment(saved));
      setMode("edit");
      setMessage(mode === "create" ? "Team member assigned." : "Team member updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save team member.");
    }
  }

  async function removeAssignment() {
    if (!selectedAssignment || !canEdit) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Remove",
      message: `Remove ${selectedAssignment.user_name ?? "this team member"}?`,
      title: "Remove Team Member",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteTeamAssignment(selectedAssignment.id);
      setSelectedAssignment(null);
      startCreate();
      await load(selectedPlanId);
      setMessage("Team member removed from plan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove team member.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Team assignments">
      {confirmationDialog}
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Plan Team</h2>
          <button className="text-button" disabled={!canEdit} onClick={startCreate} type="button">
            New Assignment
          </button>
        </div>

        <label className="filter-label">
          Plan
          <select onChange={(event) => void selectPlan(event.target.value)} value={selectedPlanId}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title}
              </option>
            ))}
          </select>
        </label>

        <div className="stack-list">
          {assignments.map((assignment) => (
            <button
              className={`stack-row ${assignment.id === selectedAssignment?.id ? "selected" : ""}`}
              key={assignment.id}
              onClick={() => selectAssignment(assignment)}
              type="button"
            >
              <strong>{assignment.user_name ?? "Unassigned"}</strong>
              <span>
                {assignment.role_label} · {assignment.instrument_name ?? "no instrument"} ·{" "}
                {assignment.status}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitAssignment(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Assign" : "Edit"}</p>
            <h2>{mode === "create" ? "Team Member" : selectedAssignment?.user_name ?? "Team"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" ? (
              <button className="danger-button" disabled={!canEdit} onClick={() => void removeAssignment()} type="button">
                Remove
              </button>
            ) : null}
            <button className="primary-button" disabled={!canEdit} type="submit">
              Save Assignment
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        {!canEdit ? (
          <p className="empty-state">You can review team assignments here, but only service leaders and worship leaders can change them.</p>
        ) : null}

        <div className="form-grid">
          <label>
            User
            <select
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, user_id: event.target.value })}
              value={form.user_id}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Role
            <input
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, role_label: event.target.value })}
              required
              value={form.role_label}
            />
          </label>

          <label>
            Instrument
            <select
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, instrument_id: event.target.value })}
              value={form.instrument_id}
            >
              <option value="">None</option>
              {instruments.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
              value={form.status}
            >
              <option value="invited">Invited</option>
              <option value="requested">Requested</option>
              <option value="confirmed">Confirmed</option>
              <option value="unavailable">Unavailable</option>
              <option value="declined">Declined</option>
            </select>
          </label>

          <label className="wide-field">
            Notes
            <textarea
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={4}
              value={form.notes}
            />
          </label>
        </div>
      </form>
    </section>
  );
}
