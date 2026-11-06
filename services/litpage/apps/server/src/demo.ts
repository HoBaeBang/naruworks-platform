import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export const DEMO_MESSAGE = 'This is turned off in the public demo.';

export function isDemoMode(): boolean {
  return process.env.NC_DEMO_MODE === '1';
}

export function demoResetHours(): number | null {
  if (!isDemoMode()) return null;
  const n = Number(process.env.NC_DEMO_RESET_HOURS);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-visitor sandboxes (demoSandbox.ts): lifetime, how many may live at once, quotas and creation limits per client address. */
export function demoLimits() {
  return {
    sandboxHours: positiveEnv('NC_DEMO_SANDBOX_HOURS', 4),
    maxSandboxes: Math.floor(positiveEnv('NC_DEMO_MAX_SANDBOXES', 300)),
    maxRecords: Math.floor(positiveEnv('NC_DEMO_MAX_RECORDS', 5000)),
    maxUploadBytes: positiveEnv('NC_DEMO_MAX_UPLOAD_MB', 25) * 1024 * 1024,
    maxFiles: Math.floor(positiveEnv('NC_DEMO_MAX_FILES', 50)),
    perIpHour: Math.floor(positiveEnv('NC_DEMO_SANDBOXES_PER_IP_HOUR', 5)),
    perIpDay: Math.floor(positiveEnv('NC_DEMO_SANDBOXES_PER_IP_DAY', 20)),
  };
}

/** Whether the shared account (NC_BOOTSTRAP_EMAIL / NC_BOOTSTRAP_PASSWORD) can sign in on this demo. */
export function demoSharedAccount(): boolean {
  return isDemoMode() && !!process.env.NC_BOOTSTRAP_EMAIL?.trim() && !!process.env.NC_BOOTSTRAP_PASSWORD;
}

export function demoConfig(): { enabled: boolean; resetHours?: number; sandboxHours?: number; sharedAccount?: boolean } {
  const hours = demoResetHours();
  if (!isDemoMode()) return { enabled: false };
  return { enabled: true, ...(hours ? { resetHours: hours } : {}), sandboxHours: demoLimits().sandboxHours, sharedAccount: demoSharedAccount() };
}

/** Only wipe a directory that clearly belongs to Litpage data. Keep the directory itself. */
export function isSafeDemoDataDir(raw: string | undefined): boolean {
  if (!raw || raw.includes('\0')) return false;
  const dir = resolve(raw);
  const home = resolve(process.env.HOME ?? '');
  const cwd = resolve(process.cwd());
  if (dir === '/' || dir === home || dir === cwd || dir === dirname(cwd) || dir === '/tmp' || dir === '/private/tmp') return false;
  if (dir.includes('/.git/') || dir.endsWith('/.git') || dir.includes('/node_modules/') || dir.includes('/.claude/')) return false;
  const name = basename(dir).toLowerCase();
  if (!/(^|[-_])(data|demo)([-_]|$)/.test(name) && name !== 'litpage' && name !== 'litpage-data') return false;
  try {
    return !lstatSync(dir).isSymbolicLink();
  } catch {
    return true;
  }
}

export function wipeDemoDataDir(raw = process.env.NC_DATA_DIR): boolean {
  if (!isSafeDemoDataDir(raw)) {
    console.warn('[server] demo reset refused: NC_DATA_DIR is unset or not a safe data directory');
    return false;
  }
  const dir = resolve(raw!);
  mkdirSync(dir, { recursive: true });
  try {
    if (lstatSync(dir).isSymbolicLink()) {
      console.warn('[server] demo reset refused: NC_DATA_DIR is a symbolic link');
      return false;
    }
  } catch {
    console.warn('[server] demo reset refused: NC_DATA_DIR could not be inspected');
    return false;
  }
  const entries = readdirSync(dir);
  for (const name of entries) rmSync(resolve(dir, name), { recursive: true, force: true });
  console.log(`[server] demo reset wiped ${dir} (${entries.length} entries)`);
  return true;
}

export function scheduleDemoExit(): NodeJS.Timeout | undefined {
  const hours = demoResetHours();
  if (!hours) return undefined;
  const target = Date.now() + hours * 3_600_000;
  const maxDelay = 2_147_000_000;
  let timer: NodeJS.Timeout;
  const arm = () => {
    const remaining = target - Date.now();
    if (remaining <= 0) {
      console.log(`[server] demo reset interval reached (${hours} hours), exiting for a clean restart`);
      process.exit(0);
      return;
    }
    timer = setTimeout(arm, Math.min(remaining, maxDelay));
    timer.unref();
  };
  arm();
  return timer!;
}

const BLOCKED_RPC_NAMES = new Set([
  'changePassword', 'removePassword', 'startTotpEnrollment', 'completeTotpEnrollment', 'renameMfaFactor', 'deleteMfaFactor', 'disableMfa', 'regenerateBackupCodes', 'sendSignInCode',
  'passkeyRegistrationOptions', 'registerPasskey', 'updatePasskeyName', 'deletePasskey', 'addSecondaryEmail', 'verifySecondaryEmail', 'removeSecondaryEmail', 'makeEmailPrimary', 'deleteAccount',
  'logoutOtherSessions', 'revokeSession', 'logoutAllAccounts',
  'beginAddAccount', 'switchAccount', 'removeAccount',
  'createWorkspace', 'inviteMembers', 'setSpaceDomain', 'leaveSpace', 'deleteWorkspace', 'setMemberRole', 'removeMember', 'resetInviteLink', 'setInviteLinkEnabled', 'joinSpaceByInviteLink',
  'requestMembers', 'resolveMemberRequest', 'setAllowedEmailDomains', 'upgradeGuests', 'removeGuest', 'createGroup', 'updateGroup', 'deleteGroup', 'setMemberExpiration', 'transferPrivatePages',
  'getPublicPages', 'removeWorkspaceConnection',
  'setDefaultTeams', 'requestUpgrade', 'changePlan', 'addCustomEmoji', 'editCustomEmoji', 'removeCustomEmoji',
  'joinWorkspace', 'requestWorkspaceMembership', 'joinTeamByInviteLink', 'getTeamInviteLink', 'resetTeamInviteLink', 'getTeamInvite', 'requestMembershipByTeamInvite', 'requestJoinTeam',
  'createTeamFromPage',
  'invitePagePermissions', 'restrictPageAccess', 'restoreInheritedAccess', 'getPublishedPage', 'duplicatePublicPage', 'requestGuestInvite', 'requestRestrictedMemberAccess', 'requestPageAccess', 'decideAccessRequest',
  'getPublicForm', 'submitFormResponse', 'emailFormResponse', 'setSiteSettings', 'getSite', 'getSiteHome', 'searchSite',
  'getWorkspaceConnections', 'adminRemovePagePermission', 'adminRestorePage', 'adminRestoreRetained',
  'saveAutomation', 'setAutomationStatus', 'deleteAutomation', 'duplicateAutomation', 'setTemplateRecurrence', 'runButtonServerSteps', 'flushAutomationsForTests',
  'devListConnections', 'devCreateConnection', 'devGetConnection', 'devUpdateConnection', 'devRefreshConnectionToken', 'devInstallationToken', 'devDeleteConnection', 'devPageConnections', 'devAddPageConnection', 'devRemovePageConnection', 'devListWebhooks', 'devVerifyWebhook', 'devResendWebhookToken', 'devUpdateWebhook', 'devDeleteWebhook', 'devWebhookFailures',
  'aiListConnections', 'aiAddConnection', 'aiRefreshConnection', 'aiUpdateConnection', 'aiRemoveConnection', 'aiUpdateMcpAllowlist', 'aiDisconnectAllConnections', 'mcpListTokens', 'mcpCreateToken', 'mcpRevokeToken', 'mcpDisableMyClient', 'mcpRevokeAll', 'mcpListClients', 'mcpClientMembers', 'mcpDisconnectClient', 'mcpSetClientRestriction', 'mcpApproveClients', 'mcpRemoveApprovedClient', 'mcpRenameClient', 'mcpListPresets', 'mcpCreatePreset', 'mcpDeletePreset',
  'aiShareThread', 'addAgentConnection', 'refreshAgentConnection', 'updateAgentConnection', 'removeAgentConnection', 'runAgent', 'resumeAgent', 'createAgent', 'updateAgentDraft', 'saveAgent', 'copyAgent', 'setAgentEnabled',
  'discardAgentDraft', 'deleteAgent', 'restoreAgent', 'permanentlyDeleteAgent', 'setAgentPermissions', 'stopAgentRun', 'stopAllAgentRuns', 'agentRunFeedback', 'resolveAgentReview',
  'agentUndoChanges', 'restoreAgentVersion', 'setAgentFavorite', 'grantAgentPageAccess', 'revokeAgentPageAccess', 'setAgentCreditLimit', 'adminRevokeAgentResource', 'transferAgentOwnership', 'adminJoinAgent',
  'aiChat', 'aiComplete', 'aiGenerateBlock', 'aiAutofill', 'aiQuery', 'aiApprove', 'aiUndoChanges', 'aiSetSkillEnabled', 'aiSetSkillAutomatic', 'aiRegisterSkill', 'aiUnsetSkill',
  'aiTableToDatabase', 'aiCreateSkill', 'aiCustomizeBuiltinSkill', 'aiSkillFile', 'aiFormula', 'aiFormulaFeedback', 'aiGenerateImageBlock', 'aiEditImageBlock', 'aiGenerateImage',
  'meetingStop', 'meetingSummarize', 'meetingUploadAudio', 'meetingRetryTranscription',
  'previewCsv', 'mergeCsv',
  // template reviews are shown to every other visitor
  'reviewTemplate',
]);

export function isDemoBlockedRpc(name: string): boolean {
  if (!isDemoMode()) return false;
  return BLOCKED_RPC_NAMES.has(name)
    || name.startsWith('dev')
    || name.startsWith('mcp')
    || /^ai(?:Add|Refresh|Update|Remove).*Connection$/.test(name)
    || /AgentConnection$/.test(name);
}

export function assertDemoRpc(name: string): void {
  if (isDemoBlockedRpc(name)) throw Object.assign(new Error(DEMO_MESSAGE), { status: 403 });
}

export function isDemoAccountEmail(email: string): boolean {
  return isDemoMode() && !!process.env.NC_BOOTSTRAP_EMAIL && email.toLowerCase() === process.env.NC_BOOTSTRAP_EMAIL.trim().toLowerCase();
}

/** Users every demo visitor may see besides themselves and their workspace members: the template gallery author
 *  (seed.ts TEMPLATE_USER_ID), shown on template previews. */
export const DEMO_VISIBLE_USER_IDS = new Set(['00000000-0000-4000-8000-00000000c0df']);

export const DEMO_DISPLAY_SETTINGS = new Set([
  'locale', 'preferred_theme', 'high_contrast', 'enter_new_line', 'number_format', 'text_direction_controls', 'start_day_of_week', 'date_format',
  'time_zone_auto', 'time_zone', 'open_links_desktop', 'start_page',
]);

export function demoPreferenceKey(key: string): boolean {
  return isDemoMode() && DEMO_DISPLAY_SETTINGS.has(key);
}
