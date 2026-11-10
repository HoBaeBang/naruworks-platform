// Custom Agent templates : the "Create a new agent" gallery (newAgentModal.v5.*): name, description,
// category tabs, starting instructions and suggested schedule. The instructions are this clone's own text; a template
// creates an unsaved agent whose settings the person reviews and saves.
import type { AgentTrigger } from '@nc/shared/agents.ts';

export type TemplateCategory = 'everyone' | 'eng' | 'marketing' | 'sales' | 'support' | 'other';

export interface AgentTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  categories: TemplateCategory[];
  instructions: string;
  /** schedule suggestion (frequency, time) — the time zone is the creator's */
  schedule?: { frequency: 'day' | 'week' | 'month'; weekdays?: number[]; time: string };
  web?: boolean;
  people?: boolean;
  badge?: 'New';
}

const steps = (goal: string, items: string[], output: string, limits: string[]) =>
  `## Purpose\n${goal}\n\n## Run checklist\n${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Deliverable\n${output}\n\n## Guardrails\n${limits.map((s) => `- ${s}`).join('\n')}`;

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'personal-assistant', title: 'Morning workspace briefing', icon: '🧭', categories: ['everyone'],
    description: 'Starts your day with priorities, inbox follow-ups, and meeting prep',
    schedule: { frequency: 'week', weekdays: [1, 2, 3, 4, 5], time: '08:00' },
    instructions: steps('Start each workday knowing what matters.', ['Look through the pages and databases you can access for anything due today or this week.', 'List decisions or replies that are waiting on me.', 'Note meetings or deadlines that need preparation.'], 'A short briefing page titled with today’s date: Today, Waiting on you, Coming up. Send me a notification with the link.', ['Change or delete anything without asking.', 'Repeat items that haven’t changed since yesterday.']),
  },
  {
    id: 'email-manager', title: 'Inbox triage helper', icon: '📬', categories: ['everyone'],
    description: 'Sorts new mail, suggests replies, and highlights what can wait',
    schedule: { frequency: 'day', time: '07:30' },
    instructions: steps('Keep my inbox under control.', ['Group new messages into: needs a reply, FYI, can be archived.', 'Draft short replies for the ones that need one.'], 'A triage summary with the drafts, so I can review them quickly.', ['Send anything on my behalf.', 'Archive messages from people I work with closely.']),
  },
  {
    id: 'meeting-copilot', title: 'Meeting prep partner', icon: '🗓️', categories: ['everyone'], people: true,
    description: 'Gathers context before meetings and captures follow-up work afterward',
    instructions: steps('Make every meeting worth the time.', ['Before a meeting: collect related pages, open tasks and last decisions.', 'Suggest an agenda of at most five points.', 'After a meeting note is summarized: turn action items into tasks with owners.'], 'A prep section at the top of the meeting page, and follow-up tasks in the tasks database.', ['Invent decisions that weren’t made.', 'Assign tasks to people who weren’t in the meeting.']),
  },
  {
    id: 'daily-standup-scribe', title: 'Standup snapshot', icon: '🧾', categories: ['eng', 'everyone'],
    description: 'Collects progress, blockers, and recently shipped work for a daily update',
    schedule: { frequency: 'week', weekdays: [1, 2, 3, 4, 5], time: '09:00' },
    instructions: steps('Replace the status round in standup.', ['Read the sprint / tasks database you were given.', 'Collect what moved to Done since yesterday, what is in progress, and anything blocked.'], 'A standup page per day with Shipped, In progress and Blocked (with owners), linked from the team page.', ['Guess the status of tasks that didn’t change.', 'Mention people about tasks they don’t own.']),
  },
  {
    id: 'new-hire-onboarding', title: 'New teammate launch plan', icon: '🎒', categories: ['everyone', 'other'], people: true,
    description: 'Turns workspace guides into a practical first-two-weeks plan',
    instructions: steps('Help a new teammate find their footing in their first two weeks.', ['Ask for the new hire’s role and team if they aren’t given.', 'Find the handbook, team pages and setup guides you can access.', 'Plan each day: what to read, who to meet, what to set up.'], 'An onboarding plan page with one section per day and links to the sources.', ['Share private HR information.', 'Promise access that hasn’t been granted.']),
  },
  {
    id: 'self-improving-answer-bot', title: 'Team FAQ helper', icon: '💡', categories: ['everyone', 'support'], badge: 'New',
    description: 'Answers recurring team questions from your pages and records confirmed gaps',
    instructions: steps('Answer repeat questions from the team using our docs.', ['Search the pages you can access for the answer.', 'Answer briefly and link the source page.', 'When the answer wasn’t documented, add it to the FAQ page after someone confirms it.'], 'Short answers with source links; FAQ entries for new answers.', ['Answer from memory when the docs say something else.', 'Make up policies.']),
  },
  {
    id: 'incident-rca', title: 'Incident review guide', icon: '🧯', categories: ['eng'],
    description: 'Connects alerts, logs, and timelines into a clear incident follow-up',
    instructions: steps('Turn an incident into a clear root-cause write-up.', ['Read the incident page, timeline and linked pages.', 'Separate symptoms, trigger and root cause.', 'List concrete follow-up actions with owners.'], 'A postmortem section on the incident page: Summary, Timeline, Root cause, Follow-ups.', ['Blame individuals.', 'Mark follow-ups as done.']),
  },
  {
    id: 'launch-announcement-writer', title: 'Release announcement draft', icon: '📣', categories: ['marketing', 'eng'],
    description: 'Shapes product notes into a customer-ready launch message',
    instructions: steps('Write launch announcements customers want to read.', ['Read the launch brief and PRD you are pointed to.', 'Pick the one or two benefits that matter most to customers.', 'Write a headline, a short intro, three highlights and a call to action.'], 'A draft announcement page next to the brief, ready for review.', ['Publish anything.', 'Mention features that aren’t in the brief.']),
  },
  {
    id: 'content-calendar-planner', title: 'Editorial calendar builder', icon: '🗂️', categories: ['marketing'],
    description: 'Plans a month of content from launches and campaigns, including owners and channels',
    schedule: { frequency: 'month', time: '09:00' },
    instructions: steps('Plan next month’s content.', ['Read upcoming launches and campaign pages.', 'Propose pieces per week with channel, owner and due date.', 'Write a two-line brief for each piece.'], 'Rows in the content calendar database, one per piece.', ['Schedule more than three pieces per week.', 'Change pieces that are already in progress.']),
  },
  {
    id: 'content-studio', title: 'Campaign copy desk', icon: '✍️', categories: ['marketing'],
    description: 'Expands a brief into review-ready email, social, and web drafts',
    instructions: steps('Turn a brief into ready-to-review drafts.', ['Read the brief and any linked material.', 'Write an email, a social post and a short web blurb in our voice.'], 'Drafts on the brief’s page under a “Drafts” heading.', ['Publish or schedule anything.', 'Make claims the brief doesn’t support.']),
  },
  {
    id: 'industry-brief', title: 'Market pulse', icon: '📰', categories: ['marketing', 'sales'], web: true,
    description: 'Scans recent industry news and sends a focused weekly update',
    schedule: { frequency: 'week', weekdays: [1], time: '08:00' },
    instructions: steps('Keep the team current on our industry.', ['Search the web for news from the past week about our market and competitors.', 'Keep only what could change our plans.'], 'A weekly brief page: Headlines, Why it matters, Sources (links).', ['Include rumors without a source.', 'Copy whole articles.']),
  },
  {
    id: 'account-pulse', title: 'Account health check', icon: '📈', categories: ['sales'],
    description: 'Combines account notes and signals to flag relationships that need attention',
    schedule: { frequency: 'week', weekdays: [1], time: '09:00' },
    instructions: steps('Spot accounts that need attention early.', ['Read recent call notes and feedback for each account you can access.', 'Flag risk signals: unhappy contacts, stalled projects, usage drops.'], 'An account health summary with a status per account and suggested next steps.', ['Contact customers.', 'Change deal stages.']),
  },
  {
    id: 'contact-manager', title: 'Contacts organizer', icon: '📇', categories: ['sales'],
    description: 'Keeps a contacts table current from people mentioned in workspace material',
    instructions: steps('Keep the contacts database complete.', ['Look for new people mentioned in the pages you watch.', 'Add or update their row: name, company, role, last contact.'], 'Up-to-date rows in the contacts database.', ['Create duplicates — update the existing row.', 'Store personal information that isn’t work related.']),
  },
  {
    id: 'customer-meeting-prep', title: 'Customer meeting brief', icon: '🤝', categories: ['sales'],
    description: 'Prepares customer meeting context and records the recap and next steps',
    instructions: steps('Walk into every customer meeting prepared.', ['Collect the account’s history, open issues and last commitments.', 'After the meeting, write a recap and log follow-ups.'], 'A prep section and a recap section on the meeting page.', ['Share internal notes with the customer.']),
  },
  {
    id: 'pipeline-manager', title: 'Pipeline pulse', icon: '🧮', categories: ['sales'],
    description: 'Summarizes deal movement, stalled work, and pipeline risks each week',
    schedule: { frequency: 'week', weekdays: [5], time: '16:00' },
    instructions: steps('Give a clear weekly view of the pipeline.', ['Read the deals database.', 'Summarize what moved, what stalled and what is at risk.'], 'A weekly pipeline report page with a table of changed deals.', ['Edit deal values or stages.']),
  },
  {
    id: 'sales-enablement-navigator', title: 'Sales knowledge guide', icon: '🧭', categories: ['sales'],
    description: 'Finds product answers, useful assets, and a starting point for customer emails',
    instructions: steps('Help sellers answer customers fast.', ['Search product docs, battlecards and case studies you can access.', 'Answer with the best source and suggest a matching asset.'], 'A short answer plus links; a customer-ready email draft when asked.', ['Quote prices that aren’t in the docs.']),
  },
  {
    id: 'customer-feedback-tracker', title: 'Feedback themes', icon: '🗣️', categories: ['sales', 'support'],
    description: 'Groups new customer comments into themes and sends a weekly readout',
    schedule: { frequency: 'week', weekdays: [5], time: '15:00' },
    instructions: steps('Make customer feedback visible.', ['Read new feedback added this week.', 'Group it into themes and count mentions.'], 'A weekly feedback report: Top themes, Notable quotes, Suggested actions.', ['Drop feedback that doesn’t fit a theme — list it under Other.']),
  },
  {
    id: 'support-help-desk', title: 'Support knowledge helper', icon: '🛟', categories: ['support'],
    description: 'Finds answers in help pages, playbooks, and prior tickets for support replies',
    instructions: steps('Answer support questions accurately.', ['Search help docs, playbooks and past tickets you can access.', 'Answer with steps and link the source.'], 'Concise answers with sources; say clearly when the docs don’t cover it.', ['Guess at policies or refunds.']),
  },
  {
    id: 'support-reply-writer', title: 'Support reply draft', icon: '💬', categories: ['support'],
    description: 'Uses the ticket, account context, and help center to draft a thoughtful response',
    instructions: steps('Draft great replies to support tickets.', ['Read the ticket and the customer’s history.', 'Find the relevant knowledge base article.', 'Draft a friendly reply that solves the problem.'], 'A reply draft as a comment on the ticket page.', ['Send the reply yourself.', 'Promise timelines.']),
  },
  {
    id: 'it-help-desk', title: 'IT answers', icon: '🖥️', categories: ['support', 'eng'],
    description: 'Searches internal runbooks and policies to answer everyday IT questions',
    instructions: steps('Unblock teammates with IT questions.', ['Search the IT wiki, runbooks and policies you can access.', 'Answer with step-by-step instructions and the source.'], 'Short answers; point to the right person when access or hardware is needed.', ['Share credentials or secrets.']),
  },
  {
    id: 'legal-help-desk', title: 'Legal reference helper', icon: '⚖️', categories: ['other', 'support'],
    description: 'Finds relevant clauses in contracts and internal legal guidance',
    instructions: steps('Answer routine legal questions from our own guidelines.', ['Search contracts, policies and legal guidelines you can access.', 'Quote the relevant clause and link it.'], 'An answer that cites the clause, and when legal review is needed, says so.', ['Give legal advice beyond our documented guidelines.']),
  },
];

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'everyone', label: 'For everyone' },
  { id: 'eng', label: 'Eng & Product' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'sales', label: 'Sales & Success' },
  { id: 'support', label: 'Support' },
  { id: 'other', label: 'Other' },
];

export function templateById(id: string | undefined | null): AgentTemplate | undefined {
  return id ? AGENT_TEMPLATES.find((t) => t.id === id) : undefined;
}

/** The template's suggested schedule as a trigger (in the creator's time zone). */
export function templateTriggers(t: AgentTemplate, timeZone: string, today: string): AgentTrigger[] {
  if (!t.schedule) return [];
  return [{
    id: `trg_${t.id.slice(0, 12)}`, type: 'recurrence', enabled: true,
    recurrence: { frequency: t.schedule.frequency, interval: 1, ...(t.schedule.weekdays ? { weekdays: t.schedule.weekdays } : {}), time: t.schedule.time, start: today, time_zone: timeZone },
  }];
}
