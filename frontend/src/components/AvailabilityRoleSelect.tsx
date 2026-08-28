export interface AvailabilityRoleOption { key: string; name: string; }

export function AvailabilityRoleSelect({ onChange, options, value }: {
  onChange: (roleKeys: string[]) => void;
  options: AvailabilityRoleOption[];
  value: string[];
}) {
  return <label>Roles<select aria-label="Roles affected by unavailable dates" multiple value={value.length ? value : [""]} onChange={(event) => {
    const selected = Array.from(event.target.selectedOptions, (option) => option.value);
    onChange(selected.includes("") ? [] : selected);
  }}><option value="">All current roles</option>{options.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select><small>{value.length ? `${value.length} role${value.length === 1 ? "" : "s"} selected` : "Applies to all current roles"}</small></label>;
}

export function availabilityRoleLabel(roleKeys: string[] | null, options: AvailabilityRoleOption[]) {
  if (!roleKeys?.length) return "All roles";
  const names = new Map(options.map((option) => [option.key, option.name]));
  return roleKeys.map((key) => names.get(key) ?? key).join(", ");
}
