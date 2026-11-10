export type ConnectionType = 'mcp_server' | 'ai_connector' | 'link_preview' | 'automation_action';
export interface ConnectionCard { name: string; litpage: boolean; desc: string; action: 'Connect' | 'Request' }
export interface ConnectionCategory { key: string; title: string; cards: ConnectionCard[] }
export interface ConnectionOption { key: string; title: string }

export const CONNECTION_CATEGORIES: ConnectionCategory[] = [
  {
    key: 'featured', title: 'Recommended connections',
    cards: [
      { name: 'Google Drive', litpage: true, desc: 'Browse shared files and bring documents into your Litpage pages.', action: 'Connect' },
      { name: 'Slack', litpage: true, desc: 'Search conversations and send selected updates to a Slack channel.', action: 'Connect' },
      { name: 'GitHub', litpage: true, desc: 'Reference repositories, issues, and pull requests from your workspace.', action: 'Connect' },
    ],
  },
  {
    key: 'communication', title: 'Communication',
    cards: [
      { name: 'Gmail', litpage: false, desc: 'Find messages and draft replies from your Gmail account.', action: 'Connect' },
      { name: 'Microsoft Teams', litpage: false, desc: 'Search team chats and channels when you need conversation context.', action: 'Connect' },
      { name: 'Zoom', litpage: false, desc: 'Look up meetings and open the corresponding Zoom details.', action: 'Connect' },
    ],
  },
  {
    key: 'projects', title: 'Projects and tasks',
    cards: [
      { name: 'Linear', litpage: true, desc: 'Search issues and projects while planning work in Litpage.', action: 'Connect' },
      { name: 'Asana', litpage: false, desc: 'Review tasks and project updates alongside your workspace notes.', action: 'Connect' },
      { name: 'GitLab', litpage: false, desc: 'Bring merge requests, issues, and project activity into context.', action: 'Connect' },
    ],
  },
  {
    key: 'files', title: 'Files and automation',
    cards: [
      { name: 'Dropbox', litpage: false, desc: 'Search and open files from shared Dropbox folders.', action: 'Connect' },
      { name: 'Zapier', litpage: false, desc: 'Trigger Litpage workflows from events in the services you use.', action: 'Connect' },
      { name: 'Make', litpage: false, desc: 'Run Make scenarios that move information into or out of Litpage.', action: 'Connect' },
    ],
  },
];

export const CATEGORY_OPTIONS: ConnectionOption[] = CONNECTION_CATEGORIES.map(({ key, title }) => ({ key, title }));
export const TYPE_OPTIONS: ConnectionOption[] = [
  { key: 'mcp_server', title: 'MCP server' },
  { key: 'ai_connector', title: 'AI connector' },
  { key: 'link_preview', title: 'Link preview' },
  { key: 'automation_action', title: 'Automation action' },
];
