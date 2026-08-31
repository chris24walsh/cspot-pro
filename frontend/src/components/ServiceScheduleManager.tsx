import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getBroadcastViewerSettings,
  getPlanTypes,
  updateBroadcastViewerSettings,
  type PlanType,
  type ServiceScheduleRule,
} from "../api";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function newRule(planTypes: PlanType[]): ServiceScheduleRule {
  return {
    id: crypto.randomUUID?.() ?? `schedule-${Date.now()}`,
    name: "New service",
    plan_type: planTypes[0]?.name ?? "Sunday Service",
    weekday: 6,
    pre_service_start: "10:30",
    countdown_start: "10:55",
    service_start: "11:00",
    cleanup_time: "13:30",
    enabled: true,
  };
}

export function ServiceScheduleManager({ onMessage, refreshToken = 0 }: { onMessage: (message: string) => void; refreshToken?: number }) {
  const [rules, setRules] = useState<ServiceScheduleRule[]>([]);
  const [planTypes, setPlanTypes] = useState<PlanType[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([getBroadcastViewerSettings(), getPlanTypes()])
      .then(([settings, types]) => {
        setRules(settings.service_schedules);
        setPlanTypes(types.filter((type) => type.active));
      })
      .catch((error) => onMessage(error instanceof Error ? error.message : "Could not load service schedules."));
  }, [onMessage, refreshToken]);

  function updateRule(index: number, patch: Partial<ServiceScheduleRule>) {
    setRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  async function save() {
    setSaving(true);
    try {
      const settings = await updateBroadcastViewerSettings({ service_schedules: rules });
      setRules(settings.service_schedules);
      onMessage("Service schedules saved.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not save service schedules.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="subsection-panel admin-settings-panel service-schedule-settings">
      <div className="section-heading">
        <div><p className="eyebrow">Presentation automation</p><h3>Service schedules</h3></div>
        <div className="action-row">
          <button className="text-button" onClick={() => setRules((current) => [...current, newRule(planTypes)])} type="button"><Plus size={15} /> Add schedule</button>
          <button className="primary-button" disabled={saving || !rules.length} onClick={() => void save()} type="button"><Save size={15} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <p className="muted-copy">Create weekly automation for Sunday services, midweek meetings, or any other plan type. Times use the church’s Europe/Dublin timezone.</p>
      <div className="stack">
        {rules.map((rule, index) => (
          <fieldset className="service-schedule-rule" key={rule.id}>
            <legend>{rule.name || `Schedule ${index + 1}`}</legend>
            <div className="broadcast-settings-grid">
              <label>Name<input maxLength={120} onChange={(event) => updateRule(index, { name: event.target.value })} value={rule.name} /></label>
              <label>Plan type<select onChange={(event) => updateRule(index, { plan_type: event.target.value })} value={rule.plan_type}>{planTypes.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}</select></label>
              <label>Day<select onChange={(event) => updateRule(index, { weekday: Number(event.target.value) })} value={rule.weekday}>{WEEKDAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}</select></label>
              <label>Welcome starts<input onChange={(event) => updateRule(index, { pre_service_start: event.target.value })} type="time" value={rule.pre_service_start} /></label>
              <label>Countdown starts<input onChange={(event) => updateRule(index, { countdown_start: event.target.value })} type="time" value={rule.countdown_start} /></label>
              <label>Service starts<input onChange={(event) => updateRule(index, { service_start: event.target.value })} type="time" value={rule.service_start} /></label>
              <label>Automatic cleanup<input onChange={(event) => updateRule(index, { cleanup_time: event.target.value })} type="time" value={rule.cleanup_time} /></label>
              <label className="toggle-row"><input checked={rule.enabled} onChange={(event) => updateRule(index, { enabled: event.target.checked })} type="checkbox" /> Enabled</label>
            </div>
            <button aria-label={`Remove ${rule.name}`} className="danger-button" onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))} type="button"><Trash2 size={14} /> Remove</button>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
