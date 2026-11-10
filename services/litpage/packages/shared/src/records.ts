// Record model: the record tables shared by the server and the client (recordMap).
// Every record has an `id` and a monotonically increasing `version` assigned by the server.
import type { Decoration } from './richtext.ts';

export type Table =
  | 'block'
  | 'space'
  | 'space_view'
  | 'team'
  | 'lit_user'
  | 'user_root'
  | 'user_settings'
  | 'collection'
  | 'collection_view'
  | 'discussion'
  | 'comment'
  | 'notification'
  | 'page_visit'
  | 'follow'
  /** database automations (server-written; packages/shared/src/automation/types.ts AutomationRecord) */
  | 'automation'
  /** Custom Agents (server-written; packages/shared/src/agents.ts AgentRecord) */
  | 'workflow';

export const TABLES: Table[] = [
  'block', 'space', 'space_view', 'team', 'lit_user', 'user_root', 'user_settings',
  'collection', 'collection_view', 'discussion', 'comment', 'notification', 'page_visit', 'follow', 'automation', 'workflow',
];

export type Role = 'editor' | 'read_and_write' | 'content_only_editor' | 'comment_only' | 'reader' | 'none';
export type SpaceRole = 'owner' | 'membership_admin' | 'editor' | 'read_and_write' | 'comment_only' | 'reader' | 'none';

export interface Pointer {
  table: Table;
  id: string;
  spaceId?: string;
}

export interface BaseRecord {
  id: string;
  version: number;
  [key: string]: unknown;
}

export type ParentTable = 'block' | 'space' | 'team' | 'collection' | 'discussion' | 'user_root';

export interface Permission {
  type: 'user_permission' | 'space_permission' | 'public_permission' | 'team_permission' | 'group_permission';
  role: Role | 'none';
  user_id?: string;
  team_id?: string;
  /** group_permission: a permission group of the workspace (space.settings.groups[].id) */
  group_id?: string;
  /** space_permission: "Hide in search" */
  unlisted?: boolean;
  added_timestamp?: number;
  allow_duplicate?: boolean;
  allow_search_engine_indexing?: boolean;
  expiry_time?: number;
  /** public_permission created by Share › Publish (Sites) rather than General access "Anyone on the web with link" */
  published?: boolean;
  published_time?: number;
  published_by_id?: string;
  /** database "Can also create pages" (Can view and create / Can comment and create / Can only create) */
  can_create_pages_in_collection?: boolean;
}

export type BlockType =
  | 'page' | 'text' | 'header' | 'sub_header' | 'sub_sub_header' | 'header_4'
  | 'bulleted_list' | 'numbered_list' | 'to_do' | 'toggle' | 'quote' | 'callout' | 'divider'
  | 'code' | 'equation' | 'table' | 'table_row' | 'column_list' | 'column'
  | 'image' | 'video' | 'audio' | 'file' | 'pdf' | 'bookmark' | 'embed' | 'html'
  | 'table_of_contents' | 'breadcrumb' | 'button' | 'tabs' | 'tab'
  | 'transclusion_container' | 'transclusion_reference' | 'alias'
  | 'collection_view' | 'collection_view_page' | 'link_to_page' | 'ai_block' | 'meeting_notes'
  | 'factory' | 'external_object_instance' | 'transcription'
  // Custom Agent chat embedded in a page (format.agent_id, features/agents/AgentChat.block.tsx)
  | 'agent_chat'
  // embed provider block types; rendered as embeds
  | 'abstract' | 'codepen' | 'deepnote' | 'drive' | 'excalidraw' | 'figma' | 'framer' | 'gist' | 'hex' | 'invision'
  | 'loom' | 'maps' | 'miro' | 'mixpanel' | 'replit' | 'sketch' | 'tweet' | 'typeform' | 'whimsical';

export interface BlockFormat {
  page_icon?: string; // emoji, icon name ("lit-icon:name:color") or file url
  page_cover?: string;
  page_cover_position?: number; // 0..1
  page_full_width?: boolean;
  page_small_text?: boolean;
  page_font?: 'default' | 'serif' | 'mono';
  block_locked?: boolean;
  block_color?: string; // e.g. "gray", "blue_background"
  toggleable?: boolean; // toggle headings
  list_start_index?: number | null;
  code_wrap?: boolean;
  code_language?: string;
  block_width?: number;
  block_height?: number;
  block_preserve_scale?: boolean;
  block_full_width?: boolean;
  block_page_width?: boolean;
  block_alignment?: 'left' | 'center' | 'right';
  display_source?: string;
  column_ratio?: number;
  table_block_column_order?: string[];
  table_block_column_header?: boolean;
  table_block_row_header?: boolean;
  table_block_column_format?: Record<string, { width?: number; color?: string }>;
  bookmark_icon?: string;
  bookmark_cover?: string;
  copied_from_pointer?: Pointer;
  [key: string]: unknown;
}

export interface BlockRecord extends BaseRecord {
  type: BlockType;
  properties?: Record<string, Decoration[]> & { title?: Decoration[]; checked?: Decoration[]; language?: Decoration[]; caption?: Decoration[]; source?: Decoration[] };
  content?: string[];
  format?: BlockFormat;
  parent_id: string;
  parent_table: ParentTable;
  space_id: string;
  alive: boolean;
  created_time: number;
  created_by_id: string;
  created_by_table?: 'lit_user';
  last_edited_time: number;
  last_edited_by_id: string;
  last_edited_by_table?: 'lit_user';
  permissions?: Permission[];
  collection_id?: string; // collection_view(_page) blocks
  view_ids?: string[];
  discussions?: string[];
  is_template?: boolean;
  file_ids?: string[];
  copied_from?: string;
  moved?: { parent_id: string; parent_table: ParentTable; moved_time: number };
  deleted_time?: number;
  deleted_by_id?: string;
}

export interface SpaceRecord extends BaseRecord {
  name: string;
  icon?: string;
  domain: string;
  pages: string[]; // workspace-level (legacy "Workspace" section) pages
  permissions: Permission[];
  plan_type: 'free' | 'plus' | 'business' | 'enterprise';
  created_by_id: string;
  created_time: number;
  invite_link_code?: string;
  settings?: Record<string, unknown>;
  disable_public_access?: boolean;
  disable_guests?: boolean;
  disable_export?: boolean;
  default_team_ids?: string[];
}

export interface SpaceViewRecord extends BaseRecord {
  space_id: string;
  parent_id: string; // user_root id (= user id)
  parent_table: 'user_root';
  alive: boolean;
  private_pages: string[];
  bookmarked_pages: string[];
  joined_teams: string[];
  sidebar_hidden_templates?: string[];
  visited_templates?: string[];
  settings?: { sidebar_sections_collapsed?: Record<string, boolean>; sidebar_width?: number; [k: string]: unknown };
  notify_mobile?: boolean;
  notify_desktop?: boolean;
  notify_email?: boolean;
  first_joined_space_time?: number;
}

export interface TeamRecord extends BaseRecord {
  space_id: string;
  name: string;
  description?: string;
  icon?: string;
  team_pages: string[];
  parent_id: string; // space id
  parent_table: 'space';
  alive: boolean;
  membership: { user_id: string; role: 'owner' | 'member'; added_time: number }[];
  settings?: { default_page_role?: Role; type?: 'open' | 'closed' | 'private'; [k: string]: unknown };
  created_time: number;
  created_by_id: string;
  is_default?: boolean;
  archived_by?: string;
}

export interface UserRecord extends BaseRecord {
  email: string;
  given_name?: string;
  family_name?: string;
  name: string;
  profile_photo?: string;
  onboarding_completed?: boolean;
  created_time?: number;
}

export interface UserRootRecord extends BaseRecord {
  space_views: string[];
  left_spaces?: string[];
  recently_visited?: string[];
}

export interface UserSettingsRecord extends BaseRecord {
  settings: {
    locale?: string;
    time_zone?: string;
    start_day_of_week?: 0 | 1;
    preferred_theme?: 'light' | 'dark' | 'system';
    open_pages_in?: 'side_peek' | 'center_peek' | 'full_page';
    cookie_consent?: Record<string, boolean>;
    [k: string]: unknown;
  };
}

export type PropertyType =
  | 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'person' | 'file'
  | 'checkbox' | 'url' | 'email' | 'phone_number' | 'formula' | 'relation' | 'rollup'
  | 'created_time' | 'created_by' | 'last_edited_time' | 'last_edited_by' | 'button'
  | 'auto_increment_id' | 'verification' | 'location' | 'place';

export interface SelectOption {
  id: string;
  value: string;
  color: string;
  description?: string;
}

export interface PropertySchema {
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  groups?: { id: string; name: string; color: string; optionIds: string[] }[]; // status
  number_format?: string;
  date_format?: string;
  time_format?: string;
  formula?: { expression: string; [k: string]: unknown };
  collection_id?: string; // relation target
  property?: string; // relation two-way counterpart prop id
  relation_property?: string; // rollup
  target_property?: string; // rollup
  aggregation?: string; // rollup
  prefix?: string; // unique id
  limit?: number;
  [k: string]: unknown;
}

export interface CollectionRecord extends BaseRecord {
  name?: Decoration[];
  description?: Decoration[];
  icon?: string;
  cover?: string;
  schema: Record<string, PropertySchema>;
  format?: {
    collection_page_properties?: { property: string; visible: boolean }[];
    property_visibility?: { property: string; visibility: 'show' | 'hide' | 'hide_if_empty' }[];
    [k: string]: unknown;
  };
  parent_id: string;
  parent_table: 'block';
  alive: boolean;
  space_id: string;
  template_pages?: string[];
  default_template_id?: string;
}

export type ViewType =
  | 'table' | 'board' | 'gallery' | 'list' | 'calendar' | 'timeline' | 'feed' | 'map' | 'chart' | 'dashboard' | 'form'
  // wiki "Home" (not in the layout picker): renders the wiki page's own blocks
  | 'page';

export interface CollectionViewRecord extends BaseRecord {
  type: ViewType;
  name: string;
  format: Record<string, unknown>;
  query2?: {
    filter?: unknown;
    sort?: { property: string; direction: 'ascending' | 'descending' }[];
    // board/group-header calcs omit `property`; status per-group calcs use {operator, groupName}
    aggregations?: { property?: string; aggregator: string | { operator: string; groupName: string }; enforceMaxAggregationLimit?: boolean }[];
    group_by?: string;
    [k: string]: unknown;
  };
  parent_id: string;
  parent_table: 'block';
  alive: boolean;
  space_id: string;
  page_sort?: string[];
}

export interface DiscussionRecord extends BaseRecord {
  parent_id: string; // block id
  parent_table: 'block';
  resolved: boolean;
  context?: Decoration[];
  /** comment on a database property value of the page (PropertyCommentButton) */
  property_id?: string;
  comments: string[];
  space_id: string;
  alive: boolean;
  /** 'default' (block/inline) | 'page' (page discussion under the title) | 'suggestion' (suggested edit) */
  type?: string;
  created_by_id?: string;
  created_time?: number;
  resolved_by_id?: string;
  resolved_time?: number;
  /** users who chose "Mute replies" on this discussion */
  muted_user_ids?: string[];
  /** suggested edits (type 'suggestion'): how the suggestion ended */
  suggestion_status?: 'accepted' | 'rejected';
}

export interface CommentRecord extends BaseRecord {
  parent_id: string; // discussion id
  parent_table: 'discussion';
  text: Decoration[];
  created_by_id: string;
  created_time: number;
  last_edited_time: number;
  alive: boolean;
  space_id: string;
  reactions?: Record<string, string[]>; // emoji -> user ids
  edited?: boolean;
  /** first comment of a 'suggestion' discussion: stands for the suggested change itself (no text) */
  suggestion?: boolean;
}

/** Page subscription ("Notify me"): the `follow` table. */
export interface FollowRecord extends BaseRecord {
  user_id: string;
  navigable_block_id: string;
  following: boolean;
  created_time: number;
  space_id: string;
  /** database pages also offer all_updates / important_updates (Notify me) */
  follow_settings?: { level?: 'all_comments' | 'replies_and_mentions' | 'all_updates' | 'important_updates' };
}

export interface NotificationRecord extends BaseRecord {
  user_id: string;
  space_id: string;
  type: 'mention' | 'comment' | 'invite' | 'page_edit' | 'reminder' | 'property_mention'
    // access requests (Inbox › Access) and teamspace membership requests; automations / agents
    | 'access_requested' | 'access_granted' | 'team_join_requested' | 'team_join_approved' | 'space_member_requested' | 'automation'
    // page verification ran out: "Page/Wiki verification expired for {pageTitle}"
    | 'verification_expired'
    // a large / workspace export finished: "Your workspace export is ready" + Download (7 days)
    | 'export_completed';
  navigable_block_id?: string;
  actor_id?: string;
  created_time: number;
  read: boolean;
  archived: boolean;
  activity?: Record<string, unknown>;
  discussion_id?: string;
  comment_id?: string;
}

export interface PageVisitRecord extends BaseRecord {
  parent_id: string;
  parent_table: 'block';
  user_id: string;
  visited_at: number;
  total_visits: number;
  space_id: string;
}

export interface RecordMapEntry<T = BaseRecord> {
  spaceId?: string;
  value: { value: T; role: Role | SpaceRole };
}

export type RecordMap = { __version__?: number } & Partial<Record<Table, Record<string, RecordMapEntry>>>;

export function recordKey(table: Table, id: string): string {
  return `${table}:${id}`;
}
