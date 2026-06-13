import { type FormEvent, useEffect, useState } from "react";

import {
  createPlanResource,
  createResource,
  deletePlanResource,
  deleteResource,
  getBibleBooks,
  getBiblePassage,
  getBibleVersions,
  getPlanResources,
  getPlans,
  getResources,
  updatePlanResource,
  updateResource,
  type BibleBook,
  type BiblePassage,
  type BibleVersion,
  type PlanResource,
  type PlanResourcePayload,
  type PlanSummary,
  type Resource,
  type ResourcePayload,
} from "../api";
import { useConfirmationDialog } from "./ConfirmationDialog";

function blankResource(): ResourcePayload {
  return { name: "", description: null, resource_type: "equipment" };
}

export function LibraryManager() {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [planResources, setPlanResources] = useState<PlanResource[]>([]);
  const [bibleVersions, setBibleVersions] = useState<BibleVersion[]>([]);
  const [bibleBooks, setBibleBooks] = useState<BibleBook[]>([]);
  const [biblePassage, setBiblePassage] = useState<BiblePassage | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [resourceForm, setResourceForm] = useState<ResourcePayload>(blankResource());
  const [resourceMode, setResourceMode] = useState<"edit" | "create">("create");
  const [resourceToAssign, setResourceToAssign] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [versionCode, setVersionCode] = useState("WEB");
  const [bookName, setBookName] = useState("John");
  const [chapter, setChapter] = useState("3");
  const [verseFrom, setVerseFrom] = useState("16");
  const [verseTo, setVerseTo] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load(planId?: string) {
    setMessage(null);

    try {
      const [nextPlans, nextResources, nextBibleVersions, nextBibleBooks] = await Promise.all([
        getPlans(),
        getResources(),
        getBibleVersions(),
        getBibleBooks(),
      ]);
      const targetPlanId = planId ?? selectedPlanId ?? nextPlans[0]?.id ?? "";
      setPlans(nextPlans);
      setResources(nextResources);
      setBibleVersions(nextBibleVersions);
      setBibleBooks(nextBibleBooks);
      setVersionCode((current) => current || nextBibleVersions[0]?.code || "");
      setBookName((current) => current || nextBibleBooks[0]?.name || "");
      setResourceToAssign(nextResources[0]?.id ?? "");
      setSelectedPlanId(targetPlanId);
      setPlanResources(targetPlanId ? await getPlanResources(targetPlanId) : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load resources.");
    }
  }

  function startCreateResource() {
    setSelectedResource(null);
    setResourceMode("create");
    setResourceForm(blankResource());
  }

  function selectResource(resource: Resource) {
    setSelectedResource(resource);
    setResourceMode("edit");
    setResourceForm({
      name: resource.name,
      description: resource.description,
      resource_type: resource.resource_type,
    });
  }

  async function selectPlan(planId: string) {
    setSelectedPlanId(planId);
    await load(planId);
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    try {
      const payload = {
        name: resourceForm.name,
        description: resourceForm.description || null,
        resource_type: resourceForm.resource_type || null,
      };
      const saved =
        resourceMode === "create"
          ? await createResource(payload)
          : await updateResource(selectedResource!.id, payload);
      await load(selectedPlanId);
      setSelectedResource(saved);
      setResourceMode("edit");
      setResourceForm({
        name: saved.name,
        description: saved.description,
        resource_type: saved.resource_type,
      });
      setMessage(resourceMode === "create" ? "Resource created." : "Resource updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save resource.");
    }
  }

  async function removeResource() {
    if (!selectedResource) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Remove",
      message: `Remove resource "${selectedResource.name}"?`,
      title: "Remove Resource",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteResource(selectedResource.id);
      setSelectedResource(null);
      startCreateResource();
      await load(selectedPlanId);
      setMessage("Resource removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove resource.");
    }
  }

  async function assignResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPlanId || !resourceToAssign) {
      setMessage("Select a plan and resource first.");
      return;
    }

    const payload: PlanResourcePayload = {
      plan_id: selectedPlanId,
      resource_id: resourceToAssign,
      notes: assignmentNotes || null,
    };

    try {
      await createPlanResource(selectedPlanId, payload);
      setAssignmentNotes("");
      await load(selectedPlanId);
      setMessage("Resource added to plan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add resource to plan.");
    }
  }

  async function updateAssignment(row: PlanResource, notes: string) {
    try {
      await updatePlanResource(row.id, { notes });
      await load(selectedPlanId);
      setMessage("Plan resource updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update plan resource.");
    }
  }

  async function removeAssignment(row: PlanResource) {
    const confirmed = await confirm({
      confirmLabel: "Remove",
      message: `Remove "${row.resource_name}" from this plan?`,
      title: "Remove From Plan",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      await deletePlanResource(row.id);
      await load(selectedPlanId);
      setMessage("Resource removed from plan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove resource from plan.");
    }
  }

  async function lookUpPassage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    try {
      setBiblePassage(
        await getBiblePassage(
          versionCode,
          bookName,
          Number(chapter),
          Number(verseFrom),
          verseTo ? Number(verseTo) : undefined,
        ),
      );
    } catch (error) {
      setBiblePassage(null);
      setMessage(error instanceof Error ? error.message : "Could not find passage.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Library management">
      {confirmationDialog}
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Resources</h2>
          <button className="text-button" onClick={startCreateResource} type="button">
            New Resource
          </button>
        </div>

        <div className="stack-list">
          {resources.map((resource) => (
            <button
              className={`stack-row ${resource.id === selectedResource?.id ? "selected" : ""}`}
              key={resource.id}
              onClick={() => selectResource(resource)}
              type="button"
            >
              <strong>{resource.name}</strong>
              <span>{resource.resource_type ?? "resource"}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="editor-panel">
        <form onSubmit={(event) => void submitResource(event)}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{resourceMode === "create" ? "Create" : "Edit"}</p>
              <h2>{resourceMode === "create" ? "Resource" : selectedResource?.name}</h2>
            </div>
            <div className="action-row">
              {resourceMode === "edit" ? (
                <button className="danger-button" onClick={() => void removeResource()} type="button">
                  Remove
                </button>
              ) : null}
              <button className="primary-button" type="submit">
                Save Resource
              </button>
            </div>
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <div className="form-grid">
            <label>
              Name
              <input
                onChange={(event) => setResourceForm({ ...resourceForm, name: event.target.value })}
                required
                value={resourceForm.name}
              />
            </label>

            <label>
              Type
              <input
                onChange={(event) =>
                  setResourceForm({ ...resourceForm, resource_type: event.target.value })
                }
                value={resourceForm.resource_type ?? ""}
              />
            </label>

            <label className="wide-field">
              Description
              <textarea
                onChange={(event) =>
                  setResourceForm({ ...resourceForm, description: event.target.value })
                }
                rows={4}
                value={resourceForm.description ?? ""}
              />
            </label>
          </div>
        </form>

        <div className="section-heading inline-heading">
          <h2>Plan Resources</h2>
        </div>

        <form className="sub-editor" onSubmit={(event) => void assignResource(event)}>
          <div className="form-grid">
            <label>
              Plan
              <select onChange={(event) => void selectPlan(event.target.value)} value={selectedPlanId}>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Resource
              <select
                onChange={(event) => setResourceToAssign(event.target.value)}
                value={resourceToAssign}
              >
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="wide-field">
              Assignment Notes
              <input
                onChange={(event) => setAssignmentNotes(event.target.value)}
                value={assignmentNotes}
              />
            </label>
          </div>
          <div className="action-row form-actions">
            <button className="primary-button" type="submit">
              Add To Plan
            </button>
          </div>
        </form>

        <div className="stack-list compact">
          {planResources.map((row) => (
            <div className="stack-row readonly" key={row.id}>
              <strong>{row.resource_name}</strong>
              <span>{row.resource_type ?? "resource"}</span>
              <div className="inline-edit-row">
                <input
                  defaultValue={row.notes ?? ""}
                  onBlur={(event) => void updateAssignment(row, event.target.value)}
                />
                <button className="danger-button" onClick={() => void removeAssignment(row)} type="button">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="section-heading inline-heading">
          <h2>Scripture Lookup</h2>
        </div>

        <form className="sub-editor" onSubmit={(event) => void lookUpPassage(event)}>
          <div className="form-grid">
            <label>
              Version
              <select onChange={(event) => setVersionCode(event.target.value)} value={versionCode}>
                {bibleVersions.map((version) => (
                  <option key={version.id} value={version.code}>
                    {version.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Book
              <select onChange={(event) => setBookName(event.target.value)} value={bookName}>
                {bibleBooks.map((book) => (
                  <option key={book.id} value={book.name}>
                    {book.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Chapter
              <input onChange={(event) => setChapter(event.target.value)} type="number" value={chapter} />
            </label>

            <label>
              Verse From
              <input
                onChange={(event) => setVerseFrom(event.target.value)}
                type="number"
                value={verseFrom}
              />
            </label>

            <label>
              Verse To
              <input onChange={(event) => setVerseTo(event.target.value)} type="number" value={verseTo} />
            </label>
          </div>
          <div className="action-row form-actions">
            <button className="primary-button" type="submit">
              Look Up
            </button>
          </div>
        </form>

        {biblePassage ? (
          <article className="message-bubble scripture-result">
            <strong>
              {biblePassage.reference} ({biblePassage.version})
            </strong>
            <p>{biblePassage.text}</p>
          </article>
        ) : null}
      </div>
    </section>
  );
}
