export type ModuleId =
  | "planning"
  | "music"
  | "worship"
  | "sunday_school"
  | "broadcast"
  | "people"
  | "presentation"
  | "imports"
  | "profile"
  | "admin";

export type FeatureStatus = "Ready" | "Partial" | "Planned";

export interface ModuleMetric {
  label: string;
  value: string;
}

export interface ModuleLane {
  title: string;
  items: string[];
}

export interface FeatureModule {
  id: ModuleId;
  label: string;
  kicker: string;
  status: FeatureStatus;
  metrics: ModuleMetric[];
  lanes: ModuleLane[];
}

export const featureModules: FeatureModule[] = [
  {
    id: "profile", label: "My Profile", kicker: "Details, serving and availability", status: "Ready", metrics: [],
    lanes: [{ title: "Profile", items: ["Personal details", "Avatar"] }, { title: "Serving", items: ["Volunteer interests", "Preferred frequency"] }, { title: "Availability", items: ["Unavailable dates"] }],
  },
  {
    id: "presentation",
    label: "Service",
    kicker: "Order, slides and sync",
    status: "Ready",
    metrics: [
      { label: "Mode", value: "Ready" },
      { label: "Slide", value: "0" },
      { label: "Cache", value: "Next" },
    ],
    lanes: [
      {
        title: "Presenter",
        items: ["Projector view", "Lyrics slides", "Bible slides", "File slides"],
      },
      {
        title: "Controller",
        items: ["Main presenter", "Current item", "Slide position", "Sync stream"],
      },
      {
        title: "Offline",
        items: ["Plan cache", "Download slides", "Delete cache", "Reconnect"],
      },
    ],
  },
  {
    id: "planning",
    label: "Plans",
    kicker: "Calendar and service order",
    status: "Partial",
    metrics: [
      { label: "Types", value: "4" },
      { label: "Notes", value: "2" },
      { label: "History", value: "On" },
    ],
    lanes: [
      {
        title: "Plan Tools",
        items: ["Calendar", "Next service", "Plan templates", "Default items"],
      },
      {
        title: "Item Tools",
        items: ["Add item", "Move item", "Soft delete", "Restore items"],
      },
      {
        title: "Collaboration",
        items: ["Plan notes", "Item notes", "Read markers", "Audit history"],
      },
    ],
  },
  {
    id: "worship",
    label: "Worship",
    kicker: "Songs and sets",
    status: "Ready",
    metrics: [
      { label: "Mode", value: "Builder" },
      { label: "Slides", value: "Songs" },
      { label: "Chords", value: "Next" },
    ],
    lanes: [
      {
        title: "Build",
        items: ["Search songs", "Add to service", "Reorder worship set", "Remove song items"],
      },
      {
        title: "Review",
        items: ["Lyric slide tiles", "Song sections", "Ready status", "Missing lyrics"],
      },
      {
        title: "Live",
        items: ["Musician view", "Chord overlay", "Transpose", "Capo shapes"],
      },
    ],
  },
  {
    id: "sunday_school",
    label: "Sunday School",
    kicker: "Lessons and cover kit",
    status: "Partial",
    metrics: [
      { label: "Mode", value: "Lessons" },
      { label: "Age", value: "5-10" },
      { label: "Source", value: "Drive" },
    ],
    lanes: [
      {
        title: "Plan",
        items: ["Sunday calendar", "Weekly theme", "Bible story", "Cover notes"],
      },
      {
        title: "Prepare",
        items: ["Craft instructions", "Printable notes", "Song choices", "Games"],
      },
      {
        title: "Fallback",
        items: ["Emergency lesson", "Quick read-through", "Age range options", "Teacher handoff"],
      },
    ],
  },
  {
    id: "broadcast",
    label: "Broadcast",
    kicker: "Remote service stream",
    status: "Partial",
    metrics: [
      { label: "Viewer", value: "Ready" },
      { label: "Slides", value: "Live" },
      { label: "Camera", value: "External" },
    ],
    lanes: [
      {
        title: "Admin controls",
        items: ["Sermon recordings", "Multi-camera livestream", "Audio routing", "Mixer desk integration"],
      },
      {
        title: "Remote Viewers",
        items: ["Live slides", "Network camera", "Starting soon", "Offline state"],
      },
    ],
  },
  {
    id: "people",
    label: "Team",
    kicker: "Roles and availability",
    status: "Planned",
    metrics: [
      { label: "Roles", value: "5" },
      { label: "Instruments", value: "6" },
      { label: "Invites", value: "1" },
    ],
    lanes: [
      {
        title: "Assignments",
        items: ["Leader", "Teacher", "Musicians", "Readers"],
      },
      {
        title: "Availability",
        items: ["Available", "Unavailable", "Confirmation token", "Reminder"],
      },
      {
        title: "Profiles",
        items: ["Instruments", "Roles", "Start page", "Retired users"],
      },
    ],
  },
  {
    id: "imports",
    label: "Imports",
    kicker: "Review-first lyrics",
    status: "Partial",
    metrics: [
      { label: "Providers", value: "3" },
      { label: "Review", value: "On" },
      { label: "Saved", value: "0" },
    ],
    lanes: [
      {
        title: "Sources",
        items: ["Manual paste", "URL review", "Public-domain seed", "Provider adapter"],
      },
      {
        title: "Review",
        items: ["Normalize text", "Source record", "Confidence", "Edit before save"],
      },
      {
        title: "Song Link",
        items: ["Create song", "Update song", "Keep provenance", "Audit import"],
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    kicker: "Reference data",
    status: "Ready",
    metrics: [
      { label: "Users", value: "Next" },
      { label: "Settings", value: "Next" },
      { label: "Migration", value: "Next" },
    ],
    lanes: [
      {
        title: "Access",
        items: ["Users", "Roles", "Permissions", "First admin"],
      },
      {
        title: "Reference Data",
        items: ["Plan types", "Song parts", "File categories", "Bible versions"],
      },
      {
        title: "System",
        items: ["Customization", "Legacy import", "Logs", "Health"],
      },
    ],
  },
];
