import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createPlan,
  createPlanItem,
  deletePlan,
  deletePlanItem,
  getPlan,
  getPlans,
  getPlanTypes,
  getSongs,
  updatePlanItem,
  updatePlan,
  type PlanDetail,
  type PlanItem,
  type PlanItemPayload,
  type PlanPayload,
  type PlanSummary,
  type PlanType,
  type Song,
} from "../api";

interface PlanFormState {
  title: string;
  subtitle: string;
  plan_type_id: string;
  service_date: string;
  status: string;
  info: string;
}

interface ItemFormState {
  item_type: string;
  sequence: string;
  title: string;
  comment: string;
  key_signature: string;
  song_id: string;
}

interface PlanManagerProps {
  onDataChange: () => void;
}

function toInputDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

function defaultDateTime() {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  date.setHours(10, 30, 0, 0);
  return toInputDateTime(date.toISOString());
}

function formFromPlan(plan: PlanDetail): PlanFormState {
  return {
    title: plan.title,
    subtitle: plan.subtitle ?? "",
    plan_type_id: plan.plan_type_id,
    service_date: toInputDateTime(plan.service_date),
    status: plan.status,
    info: plan.info ?? "",
  };
}

function payloadFromForm(form: PlanFormState): PlanPayload {
  return {
    title: form.title,
    subtitle: form.subtitle || null,
    plan_type_id: form.plan_type_id,
    service_date: new Date(form.service_date).toISOString(),
    leader_id: null,
    teacher_id: null,
    status: form.status,
    info: form.info || null,
  };
}

function itemFormFromItem(item: PlanItem): ItemFormState {
  return {
    item_type: item.item_type,
    sequence: item.sequence,
    title: item.title,
    comment: item.comment ?? "",
    key_signature: item.key_signature ?? "",
    song_id: item.song_id ?? "",
  };
}

function payloadFromItemForm(form: ItemFormState): PlanItemPayload {
  return {
    item_type: form.item_type,
    sequence: form.sequence,
    title: form.title,
    comment: form.comment || null,
    key_signature: form.key_signature || null,
    song_id: form.song_id || null,
  };
}

function nextItemSequence(plan: PlanDetail | null) {
  if (!plan?.items.length) {
    return "10.00";
  }

  const maxSequence = Math.max(...plan.items.map((item) => Number(item.sequence)));
  return (maxSequence + 10).toFixed(2);
}

function blankItemForm(plan: PlanDetail | null): ItemFormState {
  return {
    item_type: "custom",
    sequence: nextItemSequence(plan),
    title: "",
    comment: "",
    key_signature: "",
    song_id: "",
  };
}

export function PlanManager({ onDataChange }: PlanManagerProps) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planTypes, setPlanTypes] = useState<PlanType[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanDetail | null>(null);
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [itemMode, setItemMode] = useState<"edit" | "create">("create");
  const [activeTab, setActiveTab] = useState<"details" | "order">("order");
  const [form, setForm] = useState<PlanFormState>({
    title: "",
    subtitle: "",
    plan_type_id: "",
    service_date: defaultDateTime(),
    status: "draft",
    info: "",
  });
  const [itemForm, setItemForm] = useState<ItemFormState>(blankItemForm(null));
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedPlanSummary = useMemo(
    () => plans.find((plan) => plan.id === selectedPlan?.id),
    [plans, selectedPlan],
  );

  async function load(selectedId?: string | null) {
    setLoading(true);
    setMessage(null);

    try {
      const [nextPlanTypes, nextPlans, nextSongs] = await Promise.all([
        getPlanTypes(),
        getPlans(),
        getSongs(),
      ]);
      setPlanTypes(nextPlanTypes);
      setPlans(nextPlans);
      setSongs(nextSongs);

      const targetId = selectedId === null ? nextPlans[0]?.id : selectedId ?? selectedPlan?.id ?? nextPlans[0]?.id;
      if (targetId) {
        const detail = await getPlan(targetId);
        setSelectedPlan(detail);
        setForm(formFromPlan(detail));
        setSelectedItem(null);
        setItemMode("create");
        setItemForm(blankItemForm(detail));
        setMode("edit");
      } else {
        startCreate(nextPlanTypes);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load plans.");
    } finally {
      setLoading(false);
    }
  }

  function startCreate(types = planTypes) {
    setSelectedPlan(null);
    setSelectedItem(null);
    setMode("create");
    setItemMode("create");
    setForm({
      title: "New Service",
      subtitle: "",
      plan_type_id: types[0]?.id ?? "",
      service_date: defaultDateTime(),
      status: "draft",
      info: "",
    });
    setItemForm(blankItemForm(null));
  }

  function startCreateItem() {
    setSelectedItem(null);
    setItemMode("create");
    setItemForm(blankItemForm(selectedPlan));
    setActiveTab("order");
  }

  async function selectPlan(planId: string) {
    setLoading(true);
    setMessage(null);

    try {
      const detail = await getPlan(planId);
      setSelectedPlan(detail);
      setForm(formFromPlan(detail));
      setMode("edit");
      setSelectedItem(null);
      setItemMode("create");
      setItemForm(blankItemForm(detail));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load plan.");
    } finally {
      setLoading(false);
    }
  }

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    try {
      const payload = payloadFromForm(form);
      const saved =
        mode === "create" ? await createPlan(payload) : await updatePlan(selectedPlan!.id, payload);

      await load(saved.id);
      onDataChange();
      setMessage(mode === "create" ? "Plan created." : "Plan updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save plan.");
    }
  }

  async function archivePlan() {
    if (!selectedPlan) {
      return;
    }

    const confirmed = window.confirm(`Archive plan "${selectedPlan.title}"?`);
    if (!confirmed) {
      return;
    }

    setMessage(null);

    try {
      await deletePlan(selectedPlan.id);
      setSelectedPlan(null);
      setSelectedItem(null);
      await load(null);
      onDataChange();
      setMessage("Plan archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive plan.");
    }
  }

  function selectItem(item: PlanItem) {
    setSelectedItem(item);
    setItemMode("edit");
    setItemForm(itemFormFromItem(item));
    setActiveTab("order");
  }

  async function moveItem(item: PlanItem, delta: -1 | 1) {
    if (!selectedPlan) {
      return;
    }

    const items = [...selectedPlan.items].sort((left, right) => Number(left.sequence) - Number(right.sequence));
    const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
    const target = items[currentIndex + delta];
    if (!target) {
      return;
    }

    setMessage(null);
    try {
      await Promise.all([
        updatePlanItem(item.id, { sequence: target.sequence }),
        updatePlanItem(target.id, { sequence: item.sequence }),
      ]);
      const detail = await getPlan(selectedPlan.id);
      setSelectedPlan(detail);
      const moved = detail.items.find((candidate) => candidate.id === item.id) ?? null;
      setSelectedItem(moved);
      if (moved) {
        setItemForm(itemFormFromItem(moved));
      }
      onDataChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder item.");
    }
  }

  function selectSong(songId: string) {
    const song = songs.find((candidate) => candidate.id === songId);
    setItemForm({
      ...itemForm,
      song_id: songId,
      item_type: songId ? "song" : itemForm.item_type,
      title: songId && !selectedItem ? (song?.title ?? itemForm.title) : itemForm.title,
    });
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlan) {
      setMessage("Save or select a plan before adding items.");
      return;
    }

    setMessage(null);

    try {
      const payload = payloadFromItemForm(itemForm);
      const saved =
        itemMode === "create"
          ? await createPlanItem(selectedPlan.id, payload)
          : await updatePlanItem(selectedItem!.id, payload);

      const detail = await getPlan(selectedPlan.id);
      setSelectedPlan(detail);
      setSelectedItem(detail.items.find((item) => item.id === saved.id) ?? null);
      setItemMode("edit");
      setItemForm(itemFormFromItem(saved));
      onDataChange();
      setMessage(itemMode === "create" ? "Plan item added." : "Plan item updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save plan item.");
    }
  }

  async function removeItem() {
    if (!selectedPlan || !selectedItem) {
      return;
    }

    const confirmed = window.confirm(`Remove item "${selectedItem.title}" from this plan?`);
    if (!confirmed) {
      return;
    }

    setMessage(null);

    try {
      await deletePlanItem(selectedItem.id);
      const detail = await getPlan(selectedPlan.id);
      setSelectedPlan(detail);
      setSelectedItem(null);
      setItemMode("create");
      setItemForm(blankItemForm(detail));
      onDataChange();
      setMessage("Plan item removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove plan item.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Plan management">
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Plans</h2>
          <button className="text-button" onClick={() => startCreate()} type="button">
            New Plan
          </button>
        </div>

        <div className="stack-list">
          {plans.map((plan) => (
            <button
              className={`stack-row ${plan.id === selectedPlan?.id ? "selected" : ""}`}
              key={plan.id}
              onClick={() => void selectPlan(plan.id)}
              type="button"
            >
              <strong>{plan.title}</strong>
              <span>
                {new Intl.DateTimeFormat("en-IE", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date(plan.service_date))}
                {" · "}
                {plan.item_count} items
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="editor-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Create" : "Edit"}</p>
            <h2>{mode === "create" ? "New Plan" : selectedPlanSummary?.title ?? "Plan"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" ? (
              <button className="danger-button" onClick={() => void archivePlan()} type="button">
                Archive Plan
              </button>
            ) : null}
            <button
              className="primary-button"
              disabled={loading || !form.plan_type_id}
              form="plan-detail-form"
              type="submit"
            >
              Save Plan
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="tab-row" role="tablist" aria-label="Plan sections">
          <button
            className={`tab-button ${activeTab === "details" ? "active" : ""}`}
            onClick={() => setActiveTab("details")}
            type="button"
          >
            Details
          </button>
          <button
            className={`tab-button ${activeTab === "order" ? "active" : ""}`}
            onClick={() => setActiveTab("order")}
            type="button"
          >
            Running Order
          </button>
        </div>

        {activeTab === "details" ? (
          <form id="plan-detail-form" onSubmit={(event) => void submitPlan(event)}>
            <div className="form-grid">
              <label>
                Title
                <input
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  required
                  value={form.title}
                />
              </label>

              <label>
                Subtitle
                <input
                  onChange={(event) => setForm({ ...form, subtitle: event.target.value })}
                  value={form.subtitle}
                />
              </label>

              <label>
                Type
                <select
                  onChange={(event) => setForm({ ...form, plan_type_id: event.target.value })}
                  required
                  value={form.plan_type_id}
                >
                  {planTypes.map((planType) => (
                    <option key={planType.id} value={planType.id}>
                      {planType.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Date and Time
                <input
                  onChange={(event) => setForm({ ...form, service_date: event.target.value })}
                  required
                  type="datetime-local"
                  value={form.service_date}
                />
              </label>

              <label>
                Status
                <select
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  value={form.status}
                >
                  <option value="draft">Draft</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="complete">Complete</option>
                </select>
              </label>

              <label className="wide-field">
                Notes
                <textarea
                  onChange={(event) => setForm({ ...form, info: event.target.value })}
                  rows={5}
                  value={form.info}
                />
              </label>
            </div>
          </form>
        ) : (
          <>
            <div className="tab-toolbar">
              <h2>Running Order</h2>
              <button
                className="text-button"
                disabled={!selectedPlan}
                onClick={startCreateItem}
                type="button"
              >
                New Item
              </button>
            </div>

            <div className="item-editor-grid">
              <div className="stack-list compact plan-item-list">
                {(selectedPlan?.items ?? []).map((item, itemIndex) => (
                  <div
                    className={`stack-row plan-item-row ${item.id === selectedItem?.id ? "selected" : ""}`}
                    key={item.id}
                  >
                    <button className="row-main-button" onClick={() => selectItem(item)} type="button">
                      <strong>{item.title}</strong>
                      <span>
                        {item.sequence} · {item.item_type}
                        {item.key_signature ? ` · ${item.key_signature}` : ""}
                      </span>
                    </button>
                    <div className="row-menu">
                      <button disabled={itemIndex === 0} onClick={() => void moveItem(item, -1)} type="button">
                        ↑
                      </button>
                      <button
                        disabled={itemIndex === (selectedPlan?.items.length ?? 0) - 1}
                        onClick={() => void moveItem(item, 1)}
                        type="button"
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))}
              </div>

          <form className="sub-editor" onSubmit={(event) => void submitItem(event)}>
            <div className="section-heading">
              <h2>{itemMode === "create" ? "New Item" : "Edit Item"}</h2>
              <div className="action-row">
                {itemMode === "edit" ? (
                  <button className="danger-button" onClick={() => void removeItem()} type="button">
                    Remove
                  </button>
                ) : null}
                <button className="primary-button" disabled={!selectedPlan} type="submit">
                  Save Item
                </button>
              </div>
            </div>

            <div className="form-grid single-column">
              <label>
                Title
                <input
                  onChange={(event) => setItemForm({ ...itemForm, title: event.target.value })}
                  required
                  value={itemForm.title}
                />
              </label>

              <label>
                Song
                <select onChange={(event) => selectSong(event.target.value)} value={itemForm.song_id}>
                  <option value="">No linked song</option>
                  {songs.map((song) => (
                    <option key={song.id} value={song.id}>
                      {song.title}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Type
                <select
                  onChange={(event) => setItemForm({ ...itemForm, item_type: event.target.value })}
                  value={itemForm.item_type}
                >
                  <option value="custom">Custom</option>
                  <option value="welcome">Welcome</option>
                  <option value="song">Song</option>
                  <option value="reading">Reading</option>
                  <option value="message">Message</option>
                  <option value="prayer">Prayer</option>
                  <option value="video">Video</option>
                </select>
              </label>

              <label>
                Sequence
                <input
                  min="0"
                  onChange={(event) => setItemForm({ ...itemForm, sequence: event.target.value })}
                  required
                  step="0.01"
                  type="number"
                  value={itemForm.sequence}
                />
              </label>

              <label>
                Key
                <input
                  onChange={(event) =>
                    setItemForm({ ...itemForm, key_signature: event.target.value })
                  }
                  value={itemForm.key_signature}
                />
              </label>

              <label>
                Comment
                <textarea
                  onChange={(event) => setItemForm({ ...itemForm, comment: event.target.value })}
                  rows={3}
                  value={itemForm.comment}
                />
              </label>
            </div>
          </form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
