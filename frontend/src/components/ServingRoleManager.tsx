import { useEffect, useState } from "react";

import {
  createServingRole, createServingRoleCategory, getServingAreas, getServingRoleCategories,
  removeServingRole, removeServingRoleCategory, updateServingRole, updateServingRoleCategory,
  type ServingArea, type ServingAssignmentInterval, type ServingRoleCategory,
} from "../api";
import { assignmentIntervalLabel, suggestedFrequencyForInterval } from "./ServingFrequencyInput";
import { useConfirmationDialog } from "./ConfirmationDialog";

const blankRole = (category: string) => ({ name: "", category, description: "", assignment_interval: "weekly" as ServingAssignmentInterval });

export function ServingRoleManager({ onChanged }: { onChanged?: (areas: ServingArea[]) => void }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [categories, setCategories] = useState<ServingRoleCategory[]>([]);
  const [areas, setAreas] = useState<ServingArea[]>([]);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [roleDraft, setRoleDraft] = useState(blankRole(""));
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [nextCategories, nextAreas] = await Promise.all([getServingRoleCategories(), getServingAreas()]);
    setCategories(nextCategories); setAreas(nextAreas); onChanged?.(nextAreas);
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load roles.")); }, []);

  async function addCategory() {
    if (!categoryName.trim()) return;
    try { const created = await createServingRoleCategory(categoryName); setCategoryName(""); await load(); setOpenCategory(created.id); setMessage("Role category added."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not add category."); }
  }

  async function renameCategory(category: ServingRoleCategory, name: string) {
    try { await updateServingRoleCategory(category.id, name); await load(); setMessage("Role category updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update category."); }
  }

  async function deleteCategory(category: ServingRoleCategory) {
    if (!(await confirm({ title: "Remove role category", message: `Remove ${category.name} and its roles? This is blocked if any users are assigned.`, confirmLabel: "Remove category", tone: "danger" }))) return;
    try { await removeServingRoleCategory(category.id); await load(); setMessage("Role category removed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove category."); }
  }

  function startRole(area?: ServingArea, category?: string) {
    setEditingRole(area?.id ?? "new");
    setRoleDraft(area ? { name: area.name, category: area.category, description: area.description ?? "", assignment_interval: area.assignment_interval } : blankRole(category ?? categories[0]?.name ?? ""));
  }

  async function saveRole() {
    if (!roleDraft.name.trim() || !roleDraft.category) return;
    const payload = { ...roleDraft, name: roleDraft.name.trim(), description: roleDraft.description.trim() || null };
    try {
      if (editingRole === "new") await createServingRole(payload); else await updateServingRole(editingRole!, payload);
      setEditingRole(null); await load(); setMessage(editingRole === "new" ? "Serving role added." : "Serving role updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save role."); }
  }

  async function deleteRole(area: ServingArea) {
    if (!(await confirm({ title: "Remove serving role", message: `Remove ${area.name}? This is blocked while any users are assigned.`, confirmLabel: "Remove role", tone: "danger" }))) return;
    try { await removeServingRole(area.id); if (editingRole === area.id) setEditingRole(null); await load(); setMessage("Serving role removed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove role."); }
  }

  return <section className="subsection-panel admin-settings-panel serving-role-manager">
    {confirmationDialog}
    <div className="section-heading"><div><p className="eyebrow">Serving</p><h3>Role management</h3></div></div>
    <p className="muted-copy">Organize serving roles and set their normal task interval. New assignments use that interval to suggest an editable frequency.</p>
    {message ? <p className="form-message">{message}</p> : null}
    <div className="field-action-row role-category-create"><label className="wide-field">New category<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /></label><button className="text-button" disabled={!categoryName.trim()} onClick={() => void addCategory()} type="button">Add category</button></div>
    <div className="role-group-grid">{categories.map((category) => {
      const open = openCategory === category.id;
      const categoryAreas = areas.filter((area) => area.category === category.name);
      return <section className={`role-group role-category ${open ? "is-open" : ""}`} key={category.id}>
        <button className="role-category-heading" onClick={() => setOpenCategory(open ? null : category.id)} type="button"><span>{category.name}</span><small>{categoryAreas.length} role{categoryAreas.length === 1 ? "" : "s"}</small><span aria-hidden="true">{open ? "−" : "+"}</span></button>
        {open ? <div className="role-category-items"><div className="role-category-admin-row"><input aria-label={`${category.name} category name`} defaultValue={category.name} id={`category-${category.id}`} /><div className="action-row"><button className="text-button" onClick={() => { const input = document.getElementById(`category-${category.id}`) as HTMLInputElement; void renameCategory(category, input.value); }} type="button">Rename</button><button className="danger-button" onClick={() => void deleteCategory(category)} type="button">Remove category</button></div></div>
          <div className="admin-role-list">{categoryAreas.map((area) => <div className="admin-role-row selected" key={area.id}><button className="compact-serving-role-main" onClick={() => startRole(area)} type="button"><span><strong>{area.name}</strong><small>{assignmentIntervalLabel(area.assignment_interval)} · suggests 1 per {suggestedFrequencyForInterval(area.assignment_interval).period}</small></span></button><button className="danger-button" onClick={() => void deleteRole(area)} type="button">Remove</button></div>)}</div>
          <button className="text-button" onClick={() => startRole(undefined, category.name)} type="button">Add role</button>
        </div> : null}
      </section>;
    })}</div>
    {editingRole ? <div className="role-editor-panel"><div className="section-heading"><h4>{editingRole === "new" ? "Add serving role" : "Edit serving role"}</h4><button aria-label="Close role editor" className="text-button" onClick={() => setEditingRole(null)} type="button">Close</button></div><div className="form-grid"><label>Name<input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} /></label><label>Category<select value={roleDraft.category} onChange={(event) => setRoleDraft({ ...roleDraft, category: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label>Task interval<select value={roleDraft.assignment_interval} onChange={(event) => setRoleDraft({ ...roleDraft, assignment_interval: event.target.value as ServingAssignmentInterval })}><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="triweekly">Every 3 weeks</option><option value="monthly">Monthly</option></select><small>New assignments suggest 1 per {suggestedFrequencyForInterval(roleDraft.assignment_interval).period}.</small></label><label className="wide-field">Description<textarea value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} /></label></div><div className="action-row"><button className="primary-button" disabled={!roleDraft.name.trim() || !roleDraft.category} onClick={() => void saveRole()} type="button">Save role</button></div></div> : null}
  </section>;
}
