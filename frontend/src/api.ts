import { appApiBasePath } from "./paths";

function defaultApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:8000";
  }

  return appApiBasePath();
}

export const API_BASE_URL = defaultApiBaseUrl();
export const AUTH_REQUIRED_EVENT = "cspot-pro:auth-required";
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const DRIVE_SEARCH_TIMEOUT_MS = 30000;
const DECK_IMPORT_TIMEOUT_MS = 180000;
const DECK_RENDER_TIMEOUT_MS = 180000;
const LIVE_SYNC_TIMEOUT_MS = 30000;

function buildApiUrl(path: string) {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  if (base.endsWith("/api") && path.startsWith("/api/")) {
    return `${base}${path.slice(4)}`;
  }
  return `${base}${path}`;
}

export function buildAbsoluteApiUrl(path: string) {
  return buildApiUrl(path);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface PlanSummary {
  id: string;
  title: string;
  subtitle: string | null;
  service_date: string;
  status: string;
  plan_type: string;
  leader_id: string | null;
  item_count: number;
}

export interface WorshipLeaderAssignment {
  service_date: string;
  leader_id: string;
}

export interface PlanType {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  default_duration_minutes: number | null;
  active: boolean;
}

export interface PlanItem {
  id: string;
  plan_id: string;
  song_id: string | null;
  item_type: string;
  sequence: string;
  title: string;
  comment: string | null;
  key_signature: string | null;
  files: PlanItemFile[];
  teacher_notes: string | null;
}

export interface PlanHistorySnapshotItem {
  id: string;
  item_type: string;
  sequence: string;
  title: string;
  comment: string | null;
  key_signature: string | null;
  song_id: string | null;
}

export interface PlanHistoryEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
  label: string;
  before: PlanHistorySnapshotItem[];
  after: PlanHistorySnapshotItem[];
  affected: string | null;
  change_type: string;
  restorable: boolean;
}

export interface PlanItemFile {
  id: string;
  file_id: string;
  sort_order: number;
  display_name: string;
  content_type: string | null;
}

export interface PlanDetail {
  id: string;
  plan_type_id: string;
  service_date: string;
  title: string;
  subtitle: string | null;
  leader_id: string | null;
  teacher_id: string | null;
  status: string;
  info: string | null;
  items: PlanItem[];
}

export interface Song {
  id: string;
  title: string;
  alternate_title: string | null;
  author: string | null;
  lyrics: string | null;
  chords: string | null;
  ccli_number: string | null;
  book_reference: string | null;
  license: string | null;
  sequence: string | null;
  youtube_id: string | null;
  external_link: string | null;
  worship_role: string | null;
  energy: number | null;
  tempo: string | null;
  theme_tags: string | null;
  lyrics_status: string;
}

export interface WorshipSuggestedSong {
  song: Song;
  slot: string;
  score: number;
  reason: string;
  usage: {
    use_count: number;
    last_used: string | null;
  };
}

export interface WorshipSetSuggestion {
  songs: WorshipSuggestedSong[];
}

export interface WorshipSongUsage {
  song_id: string;
  use_count: number;
  last_used: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  system_role: boolean;
}

export interface Instrument {
  id: string;
  name: string;
  sort_order: number;
}

export interface TeamAssignment {
  id: string;
  plan_id: string;
  user_id: string | null;
  user_name: string | null;
  role_label: string;
  instrument_id: string | null;
  instrument_name: string | null;
  status: string;
  notes: string | null;
  confirmed: boolean;
  requested: boolean;
  available: boolean;
}

export interface TeamAssignmentPayload {
  plan_id: string;
  user_id: string | null;
  role_label: string;
  instrument_id: string | null;
  status: string;
  notes: string | null;
}

export interface Resource {
  id: string;
  name: string;
  description: string | null;
  resource_type: string | null;
}

export interface ResourcePayload {
  name: string;
  description: string | null;
  resource_type: string | null;
}

export interface PlanResource {
  id: string;
  plan_id: string;
  resource_id: string;
  resource_name: string;
  resource_type: string | null;
  notes: string | null;
}

export interface PlanResourcePayload {
  plan_id: string;
  resource_id: string;
  notes: string | null;
}

export interface StoredFile {
  id: string;
  category_id: string | null;
  song_id: string | null;
  display_name: string;
  content_type: string | null;
  checksum: string | null;
  flatten_builds: boolean;
}

export interface ItemFile {
  id: string;
  plan_item_id: string;
  file_id: string;
  sort_order: number;
  display_name: string;
  content_type: string | null;
}

export interface RenderedSlide {
  index: number;
  image_url: string;
  original_index: number | null;
  build_index: number;
  build_count: number;
}

export interface PresentationLiveSyncState {
  plan_id: string;
  session_id: string | null;
  presenter_id: string | null;
  status: string;
  index: number;
  plan_item_id: string | null;
  slide_offset: number;
  updated_at: number;
  theme: "dark" | "light";
  blanked: boolean;
  fullscreen: boolean;
  video_action: "play" | "pause" | "stop" | "fade-stop" | null;
  video_action_at: number | null;
}

export interface PresentationLiveService {
  plan_id: string;
  title: string;
  subtitle: string | null;
  service_date: string;
  plan_type: string;
  item_count: number;
  session_id: string;
  status: string;
  index: number;
  plan_item_id: string | null;
  slide_offset: number;
  updated_at: number;
  output_owner_id: string;
  output_heartbeat_at: number;
}

export interface PresentationOutputStatus {
  plan_id: string;
  active: boolean;
  owner_id: string | null;
  heartbeat_at: number | null;
  claimed: boolean;
}

export interface BibleVersion {
  id: string;
  code: string;
  name: string;
  language: string | null;
  license: string | null;
}

export interface BibleBook {
  id: string;
  name: string;
  abbreviation: string;
  testament: string;
  sort_order: number;
}

export interface BiblePassage {
  version: string;
  reference: string;
  text: string;
}

export interface BibleSearchHit {
  version: string;
  reference: string;
  text: string;
  book: string;
  chapter: number;
  verse_from: number;
  verse_to: number;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
}

export interface MessageThread {
  id: string;
  subject: string;
  creator_id: string | null;
  creator_name: string | null;
  participant_count: number;
  message_count: number;
  latest_message: string | null;
  created_at: string;
}

export interface MessageThreadDetail extends MessageThread {
  messages: Message[];
}

export interface MessageThreadPayload {
  subject: string;
  creator_id: string | null;
  participant_ids: string[];
  body: string;
}

export interface MessagePayload {
  sender_id: string | null;
  body: string;
}

export interface LyricsImportPayload {
  title: string;
  author: string | null;
  lyrics: string;
  source_url: string | null;
  source_label: string | null;
  song_id: string | null;
}

export interface LyricsImportResult {
  song_id: string;
  title: string;
  status: string;
}

export interface ParsedSlide {
  index: number;
  title: string;
  text: string;
}

export interface ParsedSlideDeck {
  filename: string;
  format: string;
  slide_count: number;
  slides: ParsedSlide[];
  notes: string[];
}

export interface CustomProviderSearchResult {
  provider: string;
  status: string;
  matches: CustomProviderMatch[];
  notes: string[];
}

export interface CustomProviderMatch {
  id: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
}

export interface CustomProviderSelectResult {
  provider: string;
  status: string;
  title: string | null;
  output_text: string | null;
  notes: string[];
}

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  start_page: string | null;
  calendar_color: string | null;
  calendar_avatar: string | null;
  worship_max_sundays_per_month: number | null;
  sunday_school_max_sundays_per_month: number | null;
  email_confirmed: boolean;
  active: boolean;
  roles: string[];
  password_set: boolean;
  invite_pending: boolean;
}

export interface Member {
  id: string;
  email: string;
  username: string;
  name: string;
  active: boolean;
  roles: string[];
  calendar_color: string | null;
  calendar_avatar: string | null;
  worship_max_sundays_per_month: number | null;
  sunday_school_max_sundays_per_month: number | null;
  approved_serving_areas: string[];
  unavailable: VolunteerUnavailability[];
}

export type VolunteerFrequency = "weekly" | "monthly" | "quarterly" | "semi_yearly" | "occasional";
export type VolunteerStatus = "pending" | "approved" | "declined";
export interface ServingArea { id: string; key: string; name: string; category: string; description: string | null; }
export interface VolunteerPreference { id: string; user_id: string; area: ServingArea; status: VolunteerStatus; preferred_frequency: VolunteerFrequency; availability_notes: string | null; admin_notes: string | null; reviewed_at: string | null; }
export interface VolunteerUnavailability { id: string; starts_on: string; ends_on: string; note: string | null; }
export interface ServingProfile { user: User; areas: ServingArea[]; preferences: VolunteerPreference[]; unavailable: VolunteerUnavailability[]; }
export interface VolunteerAdminRecord { user_id: string; user_name: string; user_email: string; preference: VolunteerPreference; unavailable: VolunteerUnavailability[]; }

export interface SessionUser extends User {
  permissions: string[];
}

export interface BootstrapStatus {
  available: boolean;
}

export interface PlanPayload {
  plan_type_id: string;
  service_date: string;
  title: string;
  subtitle: string | null;
  leader_id: string | null;
  teacher_id: string | null;
  status: string;
  info: string | null;
}

export interface PlanItemPayload {
  item_type: string;
  sequence: string;
  title: string;
  comment: string | null;
  key_signature: string | null;
  song_id: string | null;
  teacher_notes?: string | null;
}

export interface PlanHistoryPayload {
  label: string;
  before: PlanHistorySnapshotItem[];
  after: PlanHistorySnapshotItem[];
  affected?: string | null;
  change_type?: string;
  restorable?: boolean;
}

export interface UserPayload {
  email: string;
  username: string | null;
  name: string;
  start_page: string | null;
  calendar_color: string | null;
  calendar_avatar: string | null;
  worship_max_sundays_per_month: number | null;
  sunday_school_max_sundays_per_month: number | null;
  email_confirmed: boolean;
  active: boolean;
  role_names: string[];
  password?: string | null;
}

export interface UserInvitePayload {
  email: string;
  username: string | null;
  name: string;
  start_page: string | null;
  calendar_color: string | null;
  calendar_avatar: string | null;
  worship_max_sundays_per_month: number | null;
  sunday_school_max_sundays_per_month: number | null;
  email_confirmed: boolean;
  active: boolean;
  role_names: string[];
}

export interface UserInviteResponse {
  user: User;
  invitation_url: string;
  email_sent: boolean;
  expires_at: string;
}

export interface PasswordResetAdminResponse {
  reset_url: string;
  email_sent: boolean;
  expires_at: string;
}

export interface EmailTestResponse {
  sent: boolean;
  recipient: string;
}

export interface BroadcastCameraSource {
  id: string;
  label: string;
  url: string;
}

export interface BroadcastAudioSource {
  id: string;
  label: string;
  url: string | null;
  stream_name: string | null;
}

export interface BroadcastViewerSettings {
  stream_title: string;
  stream_description: string | null;
  camera_url: string | null;
  camera_sources: BroadcastCameraSource[];
  audio_sources: BroadcastAudioSource[];
  active_camera_id: string | null;
  camera_cycle_seconds: number;
  camera_cycle_started_at: string | null;
  camera_fade_ms: number;
  live_audio_url: string | null;
  live_audio_source: string;
  live_audio_stream_name: string | null;
  manual_live_audience: "off" | "public" | "admins";
  mixer_name: string | null;
  mixer_protocol: "none" | "web" | "bridge" | "audio-only";
  mixer_control_url: string | null;
  mixer_notes: string | null;
  slide_delay_ms: number;
  auto_record_sermons: boolean;
  recording_grace_seconds: number;
  pre_service_audio_url: string | null;
  pre_service_minutes: number;
  starting_soon_message: string;
  offline_message: string;
}

export interface BroadcastRecording {
  id: string;
  plan_id: string | null;
  plan_item_id: string | null;
  title: string;
  status: "recording" | "paused" | "ready" | "failed";
  media_kind: string;
  content_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  pending_stop_at: string | null;
  pending_stop_reason: string | null;
  end_reason: string | null;
  timeline: Array<{ at: number; plan_item_id: string; slide_offset: number }>;
}

export interface GoogleDriveStatus {
  configured: boolean;
  connected: boolean;
  account_email: string | null;
  account_name: string | null;
  scope: string | null;
  connected_at: string | null;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mime_type: string;
  modified_time: string | null;
  web_view_link: string | null;
  source_kind: string;
}

export interface GoogleDriveImportResponse {
  file: StoredFile;
  source: GoogleDriveFile;
}

export interface SiteContentBlock {
  id: string;
  key: string;
  label: string;
  block_type: string;
  value: string;
  draft_value: string | null;
  published: boolean;
  updated_at: string;
}

export interface SiteContentBlockPayload {
  label?: string | null;
  block_type?: string | null;
  value: string;
  published?: boolean;
}

export interface SundaySchoolLesson {
  id: string;
  lesson_date: string;
  status: string;
  teacher_name: string;
  theme: string;
  bible_reference: string;
  bible_story: string;
  crafts: string;
  songs: string;
  games: string;
  source_notes: string;
  teacher_notes: string;
  created_at: string;
  updated_at: string;
}

export interface SundaySchoolLessonPayload {
  lesson_date: string;
  status: string;
  teacher_name: string;
  theme: string;
  bible_reference: string;
  bible_story: string;
  crafts: string;
  songs: string;
  games: string;
  source_notes: string;
  teacher_notes: string;
}

export interface SundaySchoolResource {
  id: string;
  title: string;
  resource_type: string;
  age_group: string;
  source_title: string;
  theme: string;
  bible_reference: string;
  lesson_date: string | null;
  week_number: number | null;
  translation: string;
  file_name: string;
  file_path: string;
  page_start: number | null;
  page_end: number | null;
  summary: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SundaySchoolImportResult {
  scanned: number;
  imported: number;
}

export interface AuthActionToken {
  purpose: string;
  email: string;
  name: string;
  expires_at: string;
}

async function parseError(response: Response, suppressAuthEvent = false): Promise<never> {
  const text = await response.text();

  if (response.status === 401 && !suppressAuthEvent) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }

  if (response.status === 413) {
    throw new ApiError("The uploaded file is too large for the server or proxy to accept.", response.status);
  }

  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ApiError("The server or proxy could not complete that request right now.", response.status);
  }

  if (text) {
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === "string") {
        throw new ApiError(parsed.detail, response.status);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
    }
  }

  throw new ApiError(text || `API request failed: ${response.status}`, response.status);
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The server took too long to respond.", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getJson<T>(
  path: string,
  options?: { suppressAuthEvent?: boolean; timeoutMs?: number },
): Promise<T> {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    credentials: "include",
    timeoutMs: options?.timeoutMs,
  });

  if (!response.ok) {
    return parseError(response, options?.suppressAuthEvent);
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT",
  body: unknown,
  options?: { suppressAuthEvent?: boolean; timeoutMs?: number },
): Promise<T> {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: options?.timeoutMs,
  });

  if (!response.ok) {
    return parseError(response, options?.suppressAuthEvent);
  }

  return response.json() as Promise<T>;
}

async function deleteRequest(path: string, options?: { suppressAuthEvent?: boolean }): Promise<void> {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    return parseError(response, options?.suppressAuthEvent);
  }
}

async function uploadForm<T>(path: string, body: FormData, options?: { suppressAuthEvent?: boolean }): Promise<T> {
  const response = await fetchWithTimeout(buildApiUrl(path), {
    method: "POST",
    credentials: "include",
    body,
  });

  if (!response.ok) {
    return parseError(response, options?.suppressAuthEvent);
  }

  return response.json() as Promise<T>;
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  return getJson<BootstrapStatus>("/api/v1/identity/auth/bootstrap-status");
}

export async function bootstrapAdmin(payload: {
  email: string;
  name: string;
  password: string;
}): Promise<SessionUser> {
  return sendJson<SessionUser>("/api/v1/identity/auth/bootstrap", "POST", payload, {
    suppressAuthEvent: true,
  });
}

export async function login(payload: { identifier: string; password: string; remember?: boolean }): Promise<SessionUser> {
  return sendJson<SessionUser>("/api/v1/identity/auth/login", "POST", payload, {
    suppressAuthEvent: true,
  });
}

export async function getAuthActionToken(token: string): Promise<AuthActionToken> {
  const encoded = window.encodeURIComponent(token);
  return getJson<AuthActionToken>(`/api/v1/identity/auth/action-token?token=${encoded}`, {
    suppressAuthEvent: true,
  });
}

export async function completeAuthAction(payload: {
  token: string;
  password: string;
}): Promise<SessionUser> {
  return sendJson<SessionUser>("/api/v1/identity/auth/action-token/complete", "POST", payload, {
    suppressAuthEvent: true,
  });
}

export async function requestPasswordReset(payload: { email: string }): Promise<{ detail: string }> {
  return sendJson<{ detail: string }>("/api/v1/identity/auth/password-reset/request", "POST", payload, {
    suppressAuthEvent: true,
  });
}

export async function logout(): Promise<void> {
  return deleteRequest("/api/v1/identity/auth/logout", { suppressAuthEvent: true });
}

export async function getSessionUser(): Promise<SessionUser> {
  return getJson<SessionUser>("/api/v1/identity/auth/me", { suppressAuthEvent: true });
}

export async function updateMyProfile(payload: { name?: string; email?: string; username?: string; calendar_avatar?: string | null }): Promise<SessionUser> {
  return sendJson<SessionUser>("/api/v1/identity/auth/me", "PATCH", payload);
}

export async function getServingProfile(): Promise<ServingProfile> { return getJson<ServingProfile>("/api/v1/identity/serving/profile"); }
export async function saveVolunteerPreference(areaKey: string, payload: { preferred_frequency: VolunteerFrequency; availability_notes: string | null }): Promise<VolunteerPreference> { return sendJson<VolunteerPreference>(`/api/v1/identity/serving/preferences/${areaKey}`, "PUT", payload); }
export async function withdrawVolunteerPreference(areaKey: string): Promise<void> { return deleteRequest(`/api/v1/identity/serving/preferences/${areaKey}`); }
export async function addVolunteerUnavailability(payload: { starts_on: string; ends_on: string; note: string | null }): Promise<VolunteerUnavailability> { return sendJson<VolunteerUnavailability>("/api/v1/identity/serving/unavailability", "POST", payload); }
export async function removeVolunteerUnavailability(id: string): Promise<void> { return deleteRequest(`/api/v1/identity/serving/unavailability/${id}`); }
export async function getVolunteerAdminRecords(): Promise<VolunteerAdminRecord[]> { return getJson<VolunteerAdminRecord[]>("/api/v1/identity/serving/admin/volunteers"); }
export async function reviewVolunteerPreference(id: string, payload: { status: VolunteerStatus; preferred_frequency?: VolunteerFrequency; admin_notes?: string | null }): Promise<VolunteerPreference> { return sendJson<VolunteerPreference>(`/api/v1/identity/serving/admin/volunteers/${id}`, "PATCH", payload); }
export async function removeVolunteerPreference(id: string): Promise<void> { return deleteRequest(`/api/v1/identity/serving/admin/volunteers/${id}`); }

export async function getPlanTypes(): Promise<PlanType[]> {
  return getJson<PlanType[]>("/api/v1/planning/plan-types");
}

export async function getPlans(): Promise<PlanSummary[]> {
  return getJson<PlanSummary[]>("/api/v1/planning/plans");
}

export async function getWorshipLeaderAssignments(): Promise<WorshipLeaderAssignment[]> {
  return getJson<WorshipLeaderAssignment[]>("/api/v1/planning/worship-leader-assignments");
}

export async function setWorshipLeaderAssignment(serviceDate: string, leaderId: string | null): Promise<WorshipLeaderAssignment | null> {
  return sendJson<WorshipLeaderAssignment | null>(`/api/v1/planning/worship-leader-assignments/${serviceDate}`, "PATCH", {
    leader_id: leaderId,
  });
}

export async function getPlan(planId: string): Promise<PlanDetail> {
  return getJson<PlanDetail>(`/api/v1/planning/plans/${planId}`);
}

export async function getPlanHistory(planId: string): Promise<PlanHistoryEntry[]> {
  return getJson<PlanHistoryEntry[]>(`/api/v1/planning/plans/${planId}/history`);
}

export async function getLivePresentationServices(): Promise<PresentationLiveService[]> {
  return getJson<PresentationLiveService[]>("/api/v1/presentation/live");
}

export async function getPresentationLiveState(planId: string): Promise<PresentationLiveSyncState> {
  return getJson<PresentationLiveSyncState>(`/api/v1/presentation/live/${planId}`);
}

export async function updatePresentationLiveState(
  planId: string,
  payload: {
    plan_id: string;
    index: number;
    plan_item_id: string | null;
    slide_offset: number;
    updated_at: number;
    theme: "dark" | "light";
    blanked: boolean;
    fullscreen: boolean;
    video_action?: "play" | "pause" | "stop" | "fade-stop" | null;
    video_action_at?: number | null;
  },
): Promise<PresentationLiveSyncState> {
  return sendJson<PresentationLiveSyncState>(`/api/v1/presentation/live/${planId}`, "PATCH", payload, {
    timeoutMs: LIVE_SYNC_TIMEOUT_MS,
  });
}

export async function getPresentationOutputStatus(planId: string, now = Date.now()): Promise<PresentationOutputStatus> {
  return getJson<PresentationOutputStatus>(`/api/v1/presentation/output/${planId}?now=${now}`, {
    timeoutMs: LIVE_SYNC_TIMEOUT_MS,
  });
}

export async function updatePresentationOutputStatus(
  planId: string,
  payload: { owner_id: string; heartbeat_at: number; release?: boolean },
): Promise<PresentationOutputStatus> {
  return sendJson<PresentationOutputStatus>(`/api/v1/presentation/output/${planId}`, "PATCH", payload, {
    timeoutMs: LIVE_SYNC_TIMEOUT_MS,
  });
}

export async function createPlan(payload: PlanPayload): Promise<PlanDetail> {
  return sendJson<PlanDetail>("/api/v1/planning/plans", "POST", payload);
}

export async function updatePlan(planId: string, payload: Partial<PlanPayload>): Promise<PlanDetail> {
  return sendJson<PlanDetail>(`/api/v1/planning/plans/${planId}`, "PATCH", payload);
}

export async function createPlanHistoryEntry(planId: string, payload: PlanHistoryPayload): Promise<PlanHistoryEntry> {
  return sendJson<PlanHistoryEntry>(`/api/v1/planning/plans/${planId}/history`, "POST", payload);
}

export async function deletePlan(planId: string): Promise<void> {
  return deleteRequest(`/api/v1/planning/plans/${planId}`);
}

export async function restorePlan(planId: string): Promise<PlanDetail> {
  return sendJson<PlanDetail>(`/api/v1/planning/plans/${planId}/restore`, "POST", {});
}

export async function createPlanItem(planId: string, payload: PlanItemPayload): Promise<PlanItem> {
  return sendJson<PlanItem>(`/api/v1/planning/plans/${planId}/items`, "POST", payload);
}

export async function updatePlanItem(
  itemId: string,
  payload: Partial<PlanItemPayload>,
): Promise<PlanItem> {
  return sendJson<PlanItem>(`/api/v1/planning/items/${itemId}`, "PATCH", payload);
}

export async function deletePlanItem(itemId: string): Promise<void> {
  return deleteRequest(`/api/v1/planning/items/${itemId}`);
}

export async function getSongs(): Promise<Song[]> {
  return getJson<Song[]>("/api/v1/music/songs");
}

export async function getWorshipSetSuggestion(limit = 5, slots: string[] = [], categories: string[] = []): Promise<WorshipSetSuggestion> {
  const search = new URLSearchParams({ limit: String(limit) });
  slots.forEach((slot) => search.append("slots", slot));
  categories.forEach((category) => search.append("categories", category));
  return getJson<WorshipSetSuggestion>(`/api/v1/music/worship-suggestions?${search.toString()}`);
}

export async function recordWorshipSuggestionRejection(songId: string, slot: string): Promise<void> {
  await sendJson("/api/v1/music/worship-suggestion-feedback", "POST", {
    song_id: songId,
    slot,
    action: "rejected",
  });
}

export async function getWorshipSongUsage(): Promise<WorshipSongUsage[]> {
  return getJson<WorshipSongUsage[]>("/api/v1/music/worship-usage");
}

export async function createSong(payload: Omit<Song, "id" | "lyrics_status">): Promise<Song> {
  return sendJson<Song>("/api/v1/music/songs", "POST", payload);
}

export async function updateSong(
  songId: string,
  payload: Partial<Omit<Song, "id" | "lyrics_status">>,
): Promise<Song> {
  return sendJson<Song>(`/api/v1/music/songs/${songId}`, "PATCH", payload);
}

export async function deleteSong(songId: string): Promise<void> {
  return deleteRequest(`/api/v1/music/songs/${songId}`);
}

export async function getRoles(): Promise<Role[]> {
  return getJson<Role[]>("/api/v1/identity/roles");
}

export async function getUsers(): Promise<User[]> {
  return getJson<User[]>("/api/v1/identity/users");
}

export async function getMembers(): Promise<Member[]> {
  return getJson<Member[]>("/api/v1/identity/members");
}

export async function createUser(payload: UserPayload): Promise<User> {
  return sendJson<User>("/api/v1/identity/users", "POST", payload);
}

export async function inviteUser(payload: UserInvitePayload): Promise<UserInviteResponse> {
  return sendJson<UserInviteResponse>("/api/v1/identity/users/invite", "POST", payload);
}

export async function updateUser(userId: string, payload: Partial<UserPayload>): Promise<User> {
  return sendJson<User>(`/api/v1/identity/users/${userId}`, "PATCH", payload);
}

export async function deactivateUser(userId: string): Promise<void> {
  return deleteRequest(`/api/v1/identity/users/${userId}`);
}

export async function resendInvite(userId: string): Promise<UserInviteResponse> {
  return sendJson<UserInviteResponse>(`/api/v1/identity/users/${userId}/invite`, "POST", {});
}

export async function sendPasswordReset(userId: string): Promise<PasswordResetAdminResponse> {
  return sendJson<PasswordResetAdminResponse>(`/api/v1/identity/users/${userId}/password-reset`, "POST", {});
}

export async function sendTestEmail(payload: { email: string }): Promise<EmailTestResponse> {
  return sendJson<EmailTestResponse>("/api/v1/identity/email/test", "POST", payload);
}

export async function getBroadcastViewerSettings(): Promise<BroadcastViewerSettings> {
  return getJson<BroadcastViewerSettings>("/api/v1/broadcast/viewer-settings");
}

export async function updateBroadcastViewerSettings(
  payload: Partial<BroadcastViewerSettings>,
): Promise<BroadcastViewerSettings> {
  return sendJson<BroadcastViewerSettings>("/api/v1/broadcast/viewer-settings", "PATCH", payload);
}

export async function updateManualLivestream(
  audience: "off" | "public" | "admins",
): Promise<BroadcastViewerSettings> {
  return sendJson<BroadcastViewerSettings>("/api/v1/broadcast/manual-live", "PATCH", { audience });
}

export async function getBroadcastRecordings(): Promise<BroadcastRecording[]> {
  return getJson<BroadcastRecording[]>("/api/v1/broadcast/recordings");
}

export async function startBroadcastRecording(payload: {
  plan_id: string;
  plan_item_id: string | null;
}): Promise<BroadcastRecording> {
  return sendJson<BroadcastRecording>("/api/v1/broadcast/recordings/start", "POST", payload);
}

export async function stopBroadcastRecording(): Promise<BroadcastRecording | null> {
  return sendJson<BroadcastRecording | null>("/api/v1/broadcast/recordings/stop", "POST", {});
}

export async function pauseBroadcastRecording(): Promise<BroadcastRecording | null> {
  return sendJson<BroadcastRecording | null>("/api/v1/broadcast/recordings/pause", "POST", {});
}

export async function resumeBroadcastRecording(): Promise<BroadcastRecording | null> {
  return sendJson<BroadcastRecording | null>("/api/v1/broadcast/recordings/resume", "POST", {});
}

export async function deleteBroadcastRecording(recordingId: string): Promise<void> {
  return deleteRequest(`/api/v1/broadcast/recordings/${recordingId}`);
}

export function broadcastRecordingAudioUrl(recordingId: string) {
  return buildApiUrl(`/api/v1/broadcast/recordings/${recordingId}/audio`);
}

export function broadcastLiveAudioUrl() {
  return buildApiUrl("/api/v1/broadcast/live-audio");
}

export function broadcastAudioSourceTestUrl(sourceId: string) {
  return buildApiUrl(`/api/v1/broadcast/audio-sources/${encodeURIComponent(sourceId)}/test`);
}

export async function getGoogleDriveStatus(): Promise<GoogleDriveStatus> {
  return getJson<GoogleDriveStatus>("/api/v1/integrations/google-drive/status");
}

export async function disconnectGoogleDrive(): Promise<void> {
  return deleteRequest("/api/v1/integrations/google-drive/connection");
}

export async function searchGoogleDriveFiles(
  query: string,
  folderPath?: string,
  kind: "deck" | "video" = "deck",
): Promise<GoogleDriveFile[]> {
  const search = new URLSearchParams({ q: query });
  if (folderPath) {
    search.set("folder_path", folderPath);
  }
  search.set("kind", kind);
  return getJson<GoogleDriveFile[]>(`/api/v1/integrations/google-drive/files?${search.toString()}`, {
    timeoutMs: DRIVE_SEARCH_TIMEOUT_MS,
  });
}

export async function importGoogleDriveDeck(payload: {
  file_id: string;
  display_name?: string | null;
  flatten_builds?: boolean;
}): Promise<GoogleDriveImportResponse> {
  return sendJson<GoogleDriveImportResponse>("/api/v1/integrations/google-drive/import", "POST", payload, {
    timeoutMs: DECK_IMPORT_TIMEOUT_MS,
  });
}

export async function parseGoogleDriveDeck(fileId: string): Promise<ParsedSlideDeck> {
  return sendJson<ParsedSlideDeck>("/api/v1/integrations/google-drive/parse", "POST", { file_id: fileId }, {
    timeoutMs: DECK_IMPORT_TIMEOUT_MS,
  });
}

export async function getSiteContent(): Promise<SiteContentBlock[]> {
  return getJson<SiteContentBlock[]>("/api/v1/site/content", { suppressAuthEvent: true });
}

export async function getAdminSiteContent(): Promise<SiteContentBlock[]> {
  return getJson<SiteContentBlock[]>("/api/v1/site/content/admin", { suppressAuthEvent: true });
}

export async function updateSiteContentBlock(
  key: string,
  payload: SiteContentBlockPayload,
): Promise<SiteContentBlock> {
  return sendJson<SiteContentBlock>(
    `/api/v1/site/content/${encodeURIComponent(key)}`,
    "PATCH",
    payload,
    { suppressAuthEvent: true },
  );
}

export async function getSundaySchoolLessons(params?: {
  from_date?: string;
  to_date?: string;
}): Promise<SundaySchoolLesson[]> {
  const search = new URLSearchParams();
  if (params?.from_date) {
    search.set("from_date", params.from_date);
  }
  if (params?.to_date) {
    search.set("to_date", params.to_date);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson<SundaySchoolLesson[]>(`/api/v1/sunday-school/lessons${suffix}`);
}

export async function createSundaySchoolLesson(
  payload: SundaySchoolLessonPayload,
): Promise<SundaySchoolLesson> {
  return sendJson<SundaySchoolLesson>("/api/v1/sunday-school/lessons", "POST", payload);
}

export async function updateSundaySchoolLesson(
  lessonId: string,
  payload: Partial<SundaySchoolLessonPayload>,
): Promise<SundaySchoolLesson> {
  return sendJson<SundaySchoolLesson>(`/api/v1/sunday-school/lessons/${lessonId}`, "PATCH", payload);
}

export async function getSundaySchoolResources(params?: {
  lesson_date?: string;
  week_number?: number;
  age_group?: string;
  resource_type?: string;
  query?: string;
}): Promise<SundaySchoolResource[]> {
  const search = new URLSearchParams();
  if (params?.lesson_date) {
    search.set("lesson_date", params.lesson_date);
  }
  if (params?.week_number) {
    search.set("week_number", String(params.week_number));
  }
  if (params?.age_group) {
    search.set("age_group", params.age_group);
  }
  if (params?.resource_type) {
    search.set("resource_type", params.resource_type);
  }
  if (params?.query) {
    search.set("query", params.query);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return getJson<SundaySchoolResource[]>(`/api/v1/sunday-school/resources${suffix}`);
}

export async function importSundaySchoolResources(): Promise<SundaySchoolImportResult> {
  return sendJson<SundaySchoolImportResult>("/api/v1/sunday-school/resources/import-local", "POST", {});
}

export function sundaySchoolResourceFileUrl(resourceId: string): string {
  return `/api/v1/sunday-school/resources/${encodeURIComponent(resourceId)}/file`;
}

export async function getInstruments(): Promise<Instrument[]> {
  return getJson<Instrument[]>("/api/v1/people/instruments");
}

export async function getTeamAssignments(planId: string): Promise<TeamAssignment[]> {
  return getJson<TeamAssignment[]>(`/api/v1/people/plans/${planId}/team`);
}

export async function createTeamAssignment(
  planId: string,
  payload: TeamAssignmentPayload,
): Promise<TeamAssignment> {
  return sendJson<TeamAssignment>(`/api/v1/people/plans/${planId}/team`, "POST", payload);
}

export async function updateTeamAssignment(
  assignmentId: string,
  payload: Partial<TeamAssignmentPayload>,
): Promise<TeamAssignment> {
  return sendJson<TeamAssignment>(`/api/v1/people/team/${assignmentId}`, "PATCH", payload);
}

export async function deleteTeamAssignment(assignmentId: string): Promise<void> {
  return deleteRequest(`/api/v1/people/team/${assignmentId}`);
}

export async function getResources(): Promise<Resource[]> {
  return getJson<Resource[]>("/api/v1/library/resources");
}

export async function createResource(payload: ResourcePayload): Promise<Resource> {
  return sendJson<Resource>("/api/v1/library/resources", "POST", payload);
}

export async function updateResource(
  resourceId: string,
  payload: Partial<ResourcePayload>,
): Promise<Resource> {
  return sendJson<Resource>(`/api/v1/library/resources/${resourceId}`, "PATCH", payload);
}

export async function deleteResource(resourceId: string): Promise<void> {
  return deleteRequest(`/api/v1/library/resources/${resourceId}`);
}

export async function getPlanResources(planId: string): Promise<PlanResource[]> {
  return getJson<PlanResource[]>(`/api/v1/library/plans/${planId}/resources`);
}

export async function createPlanResource(
  planId: string,
  payload: PlanResourcePayload,
): Promise<PlanResource> {
  return sendJson<PlanResource>(`/api/v1/library/plans/${planId}/resources`, "POST", payload);
}

export async function updatePlanResource(
  planResourceId: string,
  payload: Partial<PlanResourcePayload>,
): Promise<PlanResource> {
  return sendJson<PlanResource>(`/api/v1/library/plan-resources/${planResourceId}`, "PATCH", payload);
}

export async function deletePlanResource(planResourceId: string): Promise<void> {
  return deleteRequest(`/api/v1/library/plan-resources/${planResourceId}`);
}

export async function getBibleVersions(): Promise<BibleVersion[]> {
  return getJson<BibleVersion[]>("/api/v1/library/bible/versions");
}

export async function getFiles(params?: {
  song_id?: string;
  category_id?: string;
}): Promise<StoredFile[]> {
  const search = new URLSearchParams();
  if (params?.song_id) {
    search.set("song_id", params.song_id);
  }
  if (params?.category_id) {
    search.set("category_id", params.category_id);
  }

  const suffix = search.size ? `?${search.toString()}` : "";
  return getJson<StoredFile[]>(`/api/v1/library/files${suffix}`);
}

export async function uploadStoredFile(payload: {
  file: File;
  display_name?: string;
  category_id?: string;
  song_id?: string;
  flatten_builds?: boolean;
}): Promise<StoredFile> {
  const body = new FormData();
  body.set("upload", payload.file);
  if (payload.display_name) {
    body.set("display_name", payload.display_name);
  }
  if (payload.category_id) {
    body.set("category_id", payload.category_id);
  }
  if (payload.song_id) {
    body.set("song_id", payload.song_id);
  }
  if (payload.flatten_builds) {
    body.set("flatten_builds", "true");
  }
  return uploadForm<StoredFile>("/api/v1/library/files", body);
}

export async function getItemFiles(planItemId: string): Promise<ItemFile[]> {
  return getJson<ItemFile[]>(`/api/v1/library/items/${planItemId}/files`);
}

export async function getFileSlides(fileId: string): Promise<RenderedSlide[]> {
  const slides = await getJson<RenderedSlide[]>(`/api/v1/library/files/${fileId}/slides`, {
    timeoutMs: DECK_RENDER_TIMEOUT_MS,
  });
  return slides.map((slide) => ({
    ...slide,
    image_url: slide.image_url.startsWith("http") ? slide.image_url : buildApiUrl(slide.image_url),
  }));
}

export async function attachItemFile(
  planItemId: string,
  payload: { file_id: string; sort_order: number },
): Promise<ItemFile> {
  return sendJson<ItemFile>(`/api/v1/library/items/${planItemId}/files`, "POST", payload);
}

export async function deleteItemFile(itemFileId: string): Promise<void> {
  return deleteRequest(`/api/v1/library/item-files/${itemFileId}`);
}

export async function getBibleBooks(): Promise<BibleBook[]> {
  return getJson<BibleBook[]>("/api/v1/library/bible/books");
}

export async function getBiblePassage(
  versionCode: string,
  bookName: string,
  chapter: number,
  verseFrom: number,
  verseTo?: number,
): Promise<BiblePassage> {
  const params = verseTo ? `?verse_to=${verseTo}` : "";
  return getJson<BiblePassage>(
    `/api/v1/library/bible/passage/${encodeURIComponent(versionCode)}/${encodeURIComponent(
      bookName,
    )}/${chapter}/${verseFrom}${params}`,
  );
}

export async function searchBible(params: {
  q: string;
  version_code: string;
  search_type?: "auto" | "reference" | "keyword";
  limit?: number;
}): Promise<BibleSearchHit[]> {
  const search = new URLSearchParams({
    q: params.q,
    version_code: params.version_code,
    search_type: params.search_type ?? "auto",
  });
  if (params.limit) {
    search.set("limit", String(params.limit));
  }
  return getJson<BibleSearchHit[]>(`/api/v1/library/bible/search?${search.toString()}`);
}

export async function getMessageThreads(): Promise<MessageThread[]> {
  return getJson<MessageThread[]>("/api/v1/communication/threads");
}

export async function getMessageThread(threadId: string): Promise<MessageThreadDetail> {
  return getJson<MessageThreadDetail>(`/api/v1/communication/threads/${threadId}`);
}

export async function createMessageThread(
  payload: MessageThreadPayload,
): Promise<MessageThreadDetail> {
  return sendJson<MessageThreadDetail>("/api/v1/communication/threads", "POST", payload);
}

export async function createMessage(
  threadId: string,
  payload: MessagePayload,
): Promise<Message> {
  return sendJson<Message>(`/api/v1/communication/threads/${threadId}/messages`, "POST", payload);
}

export async function deleteMessageThread(threadId: string): Promise<void> {
  return deleteRequest(`/api/v1/communication/threads/${threadId}`);
}

export async function saveLyricsImport(
  payload: LyricsImportPayload,
): Promise<LyricsImportResult> {
  return sendJson<LyricsImportResult>("/api/v1/imports/lyrics/save", "POST", payload);
}

export async function parseSlideDeck(file: File): Promise<ParsedSlideDeck> {
  const body = new FormData();
  body.set("upload", file);
  return uploadForm<ParsedSlideDeck>("/api/v1/imports/slides/parse", body);
}

export async function runCustomProviderSearch(searchTerm: string): Promise<CustomProviderSearchResult> {
  return sendJson<CustomProviderSearchResult>("/api/v1/imports/custom-provider/search", "POST", {
    search_term: searchTerm,
  });
}

export async function selectCustomProviderMatch(matchId: string): Promise<CustomProviderSelectResult> {
  return sendJson<CustomProviderSelectResult>("/api/v1/imports/custom-provider/select", "POST", {
    match_id: matchId,
  });
}
