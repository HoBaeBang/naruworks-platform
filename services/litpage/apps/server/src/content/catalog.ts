// Starter template catalog (seeded once per server into the hidden template-gallery space).
// Content is written for Litpage; categories cover work, life, and school.
import type { RichText } from '@nc/shared/richtext.ts';
import type { DbSpec, Spec } from './spec.ts';
import { dayOffset } from './spec.ts';

export type TemplateCategory = 'work' | 'life' | 'school';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  cover: string;
  category: TemplateCategory;
  tags: string[];
  creator: string;
  featured?: boolean;
  build: () => Spec;
}

const T = (s: string): Spec => ({ type: 'text', text: s });
const H1 = (s: string): Spec => ({ type: 'header', text: s });
const H2 = (s: string): Spec => ({ type: 'sub_header', text: s });
const H3 = (s: string): Spec => ({ type: 'sub_sub_header', text: s });
const B = (s: string, children?: Spec[]): Spec => ({ type: 'bulleted_list', text: s, ...(children ? { children } : {}) });
const N = (s: string): Spec => ({ type: 'numbered_list', text: s });
const TODO = (s: string, checked = false): Spec => ({ type: 'to_do', text: s, checked });
const CALLOUT = (icon: string, s: string | RichText, color = 'gray_background'): Spec => ({ type: 'callout', icon, text: s, format: { block_color: color } });
const DIV: Spec = { type: 'divider' };
const TOGGLE = (s: string, children: Spec[]): Spec => ({ type: 'toggle', text: s, children });
const QUOTE = (s: string): Spec => ({ type: 'quote', text: s });
const bold = (s: string): RichText => [[s, [['b']]]];

function meetingBody(agenda: string[], notes: string[], actions: [string, boolean][]): Spec[] {
  return [H3('Agenda'), ...agenda.map((s) => B(s)), H3('Notes'), ...notes.map((s) => B(s)), H3('Action items'), ...actions.map(([s, c]) => TODO(s, c))];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Capture agendas, decisions and action items for every meeting in one searchable database.',
    icon: '📝',
    cover: '/covers/gradient-2.svg',
    category: 'work',
    tags: ['Meetings', 'Docs'],
    creator: 'Litpage',
    featured: true,
    build: () => ({
      type: 'collection_view_page',
      icon: '📝',
      cover: '/covers/gradient-2.svg',
      db: {
        name: 'Meeting notes',
        description: 'All meetings, newest first.',
        schema: {
          title: { name: 'Name', type: 'title' },
          mDat: { name: 'Date', type: 'date' },
          mTyp: { name: 'Type', type: 'select', options: [{ value: 'Standup', color: 'blue' }, { value: 'Planning', color: 'purple' }, { value: '1:1', color: 'green' }, { value: 'Retro', color: 'orange' }] },
          mTag: { name: 'Tags', type: 'multi_select', options: ['Product', 'Engineering', 'Design'] },
        },
        rows: [
          { values: { title: 'Weekly sync', mDat: { date: dayOffset(-1) }, mTyp: 'Standup', mTag: ['Product', 'Engineering'] }, icon: '🗓️', children: meetingBody(['Wins from last week', 'Blockers', 'Plan for this week'], ['Launch checklist is 80% done', 'QA starts Wednesday'], [['Share launch checklist', true], ['Book QA room', false]]) },
          { values: { title: 'Q4 planning', mDat: { date: dayOffset(-3) }, mTyp: 'Planning', mTag: ['Product'] }, icon: '🎯', children: meetingBody(['Review goals', 'Prioritize roadmap', 'Assign owners'], ['Focus on onboarding and performance'], [['Draft Q4 OKRs', false], ['Send summary to the team', false]]) },
          { values: { title: 'Design review', mDat: { date: dayOffset(-6) }, mTyp: 'Retro', mTag: ['Design'] }, icon: '🎨', children: meetingBody(['Walk through new settings flow', 'Open questions'], ['Simplify the first step', 'Keep dark mode parity'], [['Update mocks', true]]) },
        ],
        views: [{ type: 'table', name: 'All meetings', visible: ['mDat', 'mTyp', 'mTag'], sort: [{ property: 'mDat', direction: 'descending' }] }, { type: 'board', name: 'By type', groupBy: 'mTyp', visible: ['mDat'] }],
      },
    }),
  },
  {
    id: 'project-tracker',
    name: 'Project tracker',
    description: 'Track projects from idea to launch with status, priority and progress at a glance.',
    icon: '🚀',
    cover: '/covers/gradient-4.svg',
    category: 'work',
    tags: ['Projects', 'Product management'],
    creator: 'Litpage',
    featured: true,
    build: () => ({
      type: 'collection_view_page',
      icon: '🚀',
      cover: '/covers/gradient-4.svg',
      db: {
        name: 'Projects',
        schema: {
          title: { name: 'Project name', type: 'title' },
          pSta: { name: 'Status', type: 'status' },
          pPri: { name: 'Priority', type: 'select', options: [{ value: 'High', color: 'red' }, { value: 'Medium', color: 'yellow' }, { value: 'Low', color: 'gray' }] },
          pDue: { name: 'Due date', type: 'date' },
          pPro: { name: 'Progress', type: 'number', number_format: 'percent' },
        },
        rows: [
          { values: { title: 'Website redesign', pSta: 'In progress', pPri: 'High', pDue: { date: dayOffset(14) }, pPro: 0.6 }, icon: '🌐', children: [H2('Goal'), T('Refresh the marketing site with the new brand.'), H2('Milestones'), TODO('Wireframes', true), TODO('Visual design', true), TODO('Build pages'), TODO('Launch')] },
          { values: { title: 'Mobile onboarding', pSta: 'Not started', pPri: 'Medium', pDue: { date: dayOffset(30) }, pPro: 0 }, icon: '📱', children: [T('Shorten the first-run experience to three steps.')] },
          { values: { title: 'Billing migration', pSta: 'In progress', pPri: 'High', pDue: { date: dayOffset(7) }, pPro: 0.35 }, icon: '💳' },
          { values: { title: 'Help center refresh', pSta: 'Done', pPri: 'Low', pDue: { date: dayOffset(-5) }, pPro: 1 }, icon: '📚' },
        ],
        views: [{ type: 'board', name: 'By status', groupBy: 'pSta', visible: ['pPri', 'pDue'] }, { type: 'table', name: 'All projects' }],
      },
    }),
  },
  {
    id: 'todo-list',
    name: 'Daily checklist',
    description: 'A simple checklist to plan your day, your week and everything after.',
    icon: '✅',
    cover: '/covers/solid-blue.svg',
    category: 'life',
    tags: ['Personal', 'Productivity'],
    creator: 'Litpage',
    featured: true,
    build: () => ({
      type: 'page',
      text: 'Daily checklist',
      icon: '✅',
      cover: '/covers/solid-blue.svg',
      children: [
        CALLOUT('💡', 'Check things off as you go. Drag items between sections to reschedule them.'),
        H2('Today'),
        TODO('Reply to important emails'),
        TODO('30 minutes of focused work'),
        TODO('Go for a walk', true),
        H2('This week'),
        TODO('Plan weekend trip'),
        TODO('Call the dentist'),
        TODO('Finish reading current book'),
        H2('Later'),
        TODO('Organize photos'),
        TODO('Learn a new recipe'),
      ],
    }),
  },
  {
    id: 'weekly-planner',
    name: 'Weekly planner',
    description: 'Plan each day of the week with priorities, tasks and a short reflection.',
    icon: '🗓️',
    cover: '/covers/gradient-6.svg',
    category: 'life',
    tags: ['Personal', 'Planning'],
    creator: 'Litpage',
    build: () => ({
      type: 'page',
      text: 'Weekly planner',
      icon: '🗓️',
      cover: '/covers/gradient-6.svg',
      children: [
        QUOTE('“Plans are nothing; planning is everything.”'),
        H2('Top 3 priorities'),
        N('Ship the project update'),
        N('Exercise four times'),
        N('Call family'),
        DIV,
        { type: 'column_list', children: [
          { type: 'column', children: [H3('Monday'), TODO('Team sync'), TODO('Gym'), H3('Tuesday'), TODO('Write draft'), H3('Wednesday'), TODO('Review PRs')] },
          { type: 'column', children: [H3('Thursday'), TODO('1:1s'), H3('Friday'), TODO('Weekly review'), H3('Weekend'), TODO('Hike'), TODO('Meal prep')] },
        ] },
        DIV,
        H2('Reflection'),
        TOGGLE('What felt good this week?', [T('')]),
        TOGGLE('What could be better?', [T('')]),
      ],
    }),
  },
  {
    id: 'reading-list',
    name: 'Reading list',
    description: 'Keep track of books, articles and podcasts — what to read next and what you thought.',
    icon: '📚',
    cover: '/covers/texture-vintage-paper.svg',
    category: 'life',
    tags: ['Personal', 'Learning'],
    creator: 'Litpage',
    featured: true,
    build: () => ({
      type: 'collection_view_page',
      icon: '📚',
      cover: '/covers/texture-vintage-paper.svg',
      db: {
        name: 'Reading list',
        schema: {
          title: { name: 'Title', type: 'title' },
          rAut: { name: 'Author', type: 'text' },
          rSta: { name: 'Status', type: 'select', options: [{ value: 'To read', color: 'gray' }, { value: 'Reading', color: 'blue' }, { value: 'Finished', color: 'green' }] },
          rTyp: { name: 'Type', type: 'select', options: [{ value: 'Book', color: 'brown' }, { value: 'Article', color: 'purple' }, { value: 'Podcast', color: 'pink' }] },
          rRat: { name: 'Rating', type: 'select', options: [{ value: '⭐️⭐️⭐️⭐️⭐️', color: 'yellow' }, { value: '⭐️⭐️⭐️⭐️', color: 'yellow' }, { value: '⭐️⭐️⭐️', color: 'yellow' }] },
          rLnk: { name: 'Link', type: 'url' },
        },
        rows: [
          { values: { title: 'The Pragmatic Programmer', rAut: 'Andrew Hunt, David Thomas', rSta: 'Finished', rTyp: 'Book', rRat: '⭐️⭐️⭐️⭐️⭐️' }, icon: '📗', children: [H2('Key ideas'), B('Care about your craft'), B('Don’t live with broken windows'), B('Tracer bullets beat prototypes for exploration')] },
          { values: { title: 'Deep Work', rAut: 'Cal Newport', rSta: 'Reading', rTyp: 'Book' }, icon: '📘' },
          { values: { title: 'How to Take Smart Notes', rAut: 'Sönke Ahrens', rSta: 'To read', rTyp: 'Book' }, icon: '📙' },
          { values: { title: 'The Feynman Technique', rAut: 'Blog post', rSta: 'To read', rTyp: 'Article', rLnk: 'https://en.wikipedia.org/wiki/Richard_Feynman' }, icon: '📰' },
        ],
        views: [{ type: 'board', name: 'By status', groupBy: 'rSta', visible: ['rAut', 'rTyp'] }, { type: 'table', name: 'All' }, { type: 'gallery', name: 'Gallery', visible: ['rAut'] }],
      },
    }),
  },
  {
    id: 'journal',
    name: 'Journal',
    description: 'A private daily journal with mood tracking and tags for the moments worth remembering.',
    icon: '📓',
    cover: '/covers/gradient-1.svg',
    category: 'life',
    tags: ['Personal', 'Wellness'],
    creator: 'Litpage',
    build: () => ({
      type: 'collection_view_page',
      icon: '📓',
      cover: '/covers/gradient-1.svg',
      db: {
        name: 'Journal',
        schema: {
          title: { name: 'Entry', type: 'title' },
          jDat: { name: 'Date', type: 'date' },
          jMoo: { name: 'Mood', type: 'select', options: [{ value: '😊 Great', color: 'green' }, { value: '🙂 Good', color: 'blue' }, { value: '😐 Okay', color: 'gray' }, { value: '😔 Low', color: 'purple' }] },
          jTag: { name: 'Tags', type: 'multi_select', options: ['Work', 'Family', 'Health', 'Ideas'] },
        },
        rows: [
          { values: { title: 'A productive Monday', jDat: { date: dayOffset(0) }, jMoo: '😊 Great', jTag: ['Work'] }, children: [T('Finished the big presentation and got great feedback.'), H3('Grateful for'), B('Morning coffee with a friend'), B('Sunny weather')] },
          { values: { title: 'Long walk & new ideas', jDat: { date: dayOffset(-1) }, jMoo: '🙂 Good', jTag: ['Health', 'Ideas'] }, children: [T('Walked 8 km and sketched an idea for a side project.')] },
          { values: { title: 'Slow day', jDat: { date: dayOffset(-2) }, jMoo: '😐 Okay', jTag: ['Family'] } },
        ],
        views: [{ type: 'table', name: 'Entries', visible: ['jDat', 'jMoo', 'jTag'], sort: [{ property: 'jDat', direction: 'descending' }] }, { type: 'gallery', name: 'Gallery', visible: ['jDat', 'jMoo'] }],
      },
    }),
  },
  {
    id: 'travel-planner',
    name: 'Travel planner',
    description: 'Itinerary, packing list and budget for your next trip — all on one page.',
    icon: '✈️',
    cover: '/covers/gradient-3.svg',
    category: 'life',
    tags: ['Travel', 'Planning'],
    creator: 'Litpage',
    build: () => ({
      type: 'page',
      text: 'Travel planner',
      icon: '✈️',
      cover: '/covers/gradient-3.svg',
      children: [
        CALLOUT('🧳', [['Trip: '], ['Lisbon, Portugal', [['b']]], [` · ${dayOffset(30)} → ${dayOffset(36)}`]], 'blue_background'),
        H2('Itinerary'),
        TOGGLE('Day 1 — Arrival', [B('Check in at the hotel'), B('Dinner in Alfama')]),
        TOGGLE('Day 2 — City walk', [B('Tram 28'), B('Belém Tower'), B('Pastéis de nata')]),
        TOGGLE('Day 3 — Sintra day trip', [B('Pena Palace'), B('Quinta da Regaleira')]),
        H2('Packing list'),
        TODO('Passport'),
        TODO('Chargers & adapters'),
        TODO('Comfortable shoes'),
        TODO('Sunscreen'),
        H2('Budget'),
        { type: 'table', tableHeader: true, table: [['Item', 'Estimate', 'Actual'], ['Flights', '$420', ''], ['Hotel (6 nights)', '$780', ''], ['Food', '$300', ''], ['Activities', '$150', '']] },
      ],
    }),
  },
  {
    id: 'team-wiki',
    name: 'Team wiki',
    description: 'One home for your team’s knowledge: onboarding, how we work, and the tools we use.',
    icon: '📖',
    cover: '/covers/pattern-grid.svg',
    category: 'work',
    tags: ['Docs', 'Company wiki'],
    creator: 'Litpage',
    featured: true,
    build: () => ({
      type: 'page',
      text: 'Team wiki',
      icon: '📖',
      cover: '/covers/pattern-grid.svg',
      children: [
        CALLOUT('👋', 'Welcome to the team! Start with Onboarding, then explore the rest of the wiki.'),
        H2('Getting started'),
        { type: 'page', text: 'Onboarding', icon: '🚀', children: [H2('Your first week'), TODO('Set up your laptop'), TODO('Meet your onboarding buddy'), TODO('Read “How we work”'), H2('Useful links'), B('Company handbook'), B('Benefits overview')] },
        { type: 'page', text: 'How we work', icon: '🧭', children: [H2('Values'), N('Default to transparency'), N('Write things down'), N('Ship small, ship often'), H2('Rituals'), B('Monday planning'), B('Friday demos')] },
        { type: 'page', text: 'Engineering guidelines', icon: '🛠️', children: [H2('Code review'), B('Keep pull requests small'), B('Explain the why in the description'), H2('Release process'), N('Merge to main'), N('Deploy to staging'), N('Smoke test, then promote'), { type: 'code', language: 'Shell', text: 'npm run test && npm run deploy:staging' }] },
        H2('Policies'),
        { type: 'page', text: 'Time off', icon: '🌴', children: [T('Take the time you need — just let your team know in advance.')] },
        { type: 'page', text: 'Expenses', icon: '🧾', children: [T('Submit receipts within 30 days of purchase.')] },
      ],
    }),
  },
  {
    id: 'roadmap',
    name: 'Product roadmap',
    description: 'Plan what to build each quarter and share progress across teams.',
    icon: '🗺️',
    cover: '/covers/gradient-5.svg',
    category: 'work',
    tags: ['Product management', 'Projects'],
    creator: 'Litpage',
    build: () => ({
      type: 'collection_view_page',
      icon: '🗺️',
      cover: '/covers/gradient-5.svg',
      db: {
        name: 'Roadmap',
        schema: {
          title: { name: 'Feature', type: 'title' },
          rmSt: { name: 'Status', type: 'status', options: ['Not started', 'Planning', 'In progress', 'Shipped'] },
          rmQ: { name: 'Quarter', type: 'select', options: [{ value: 'Q1', color: 'gray' }, { value: 'Q2', color: 'blue' }, { value: 'Q3', color: 'purple' }, { value: 'Q4', color: 'green' }] },
          rmTm: { name: 'Team', type: 'select', options: [{ value: 'Growth', color: 'orange' }, { value: 'Platform', color: 'blue' }, { value: 'Mobile', color: 'pink' }] },
          rmDt: { name: 'Target date', type: 'date' },
        },
        rows: [
          { values: { title: 'Dark mode', rmSt: 'Shipped', rmQ: 'Q3', rmTm: 'Platform', rmDt: { date: dayOffset(-20) } }, icon: '🌙' },
          { values: { title: 'Offline sync', rmSt: 'In progress', rmQ: 'Q4', rmTm: 'Platform', rmDt: { date: dayOffset(40) } }, icon: '📡' },
          { values: { title: 'Referral program', rmSt: 'Planning', rmQ: 'Q4', rmTm: 'Growth', rmDt: { date: dayOffset(60) } }, icon: '🎁' },
          { values: { title: 'Widgets', rmSt: 'Not started', rmQ: 'Q1', rmTm: 'Mobile' }, icon: '🧩' },
        ],
        views: [{ type: 'board', name: 'By status', groupBy: 'rmSt', visible: ['rmQ', 'rmTm'] }, { type: 'table', name: 'All features' }, { type: 'list', name: 'List', visible: ['rmQ'] }],
      },
    }),
  },
  {
    id: 'habit-tracker',
    name: 'Habit tracker',
    description: 'Build better routines by checking off daily habits and watching streaks grow.',
    icon: '🔁',
    cover: '/covers/pattern-dots.svg',
    category: 'life',
    tags: ['Health', 'Personal'],
    creator: 'Litpage',
    build: () => ({
      type: 'collection_view_page',
      icon: '🔁',
      cover: '/covers/pattern-dots.svg',
      db: {
        name: 'Habit tracker',
        schema: {
          title: { name: 'Day', type: 'title' },
          hDat: { name: 'Date', type: 'date' },
          hExe: { name: 'Exercise', type: 'checkbox' },
          hRea: { name: 'Read', type: 'checkbox' },
          hMed: { name: 'Meditate', type: 'checkbox' },
          hWat: { name: '8 glasses of water', type: 'checkbox' },
        },
        rows: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.now() - (6 - i) * 86_400_000);
          return {
            values: {
              title: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
              hDat: { date: dayOffset(-(6 - i)) }, hExe: i % 2 === 0, hRea: i % 3 !== 0, hMed: i > 2, hWat: i % 2 === 1,
            },
          };
        }),
        views: [{ type: 'table', name: 'This week' }],
      },
    }),
  },

];

export function templateMeta(t: TemplateDef) {
  const { build: _b, ...meta } = t;
  return meta;
}

export type DbSpecT = DbSpec;
