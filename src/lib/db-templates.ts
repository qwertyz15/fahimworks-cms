import type { OptionColor, PropertyType, StatusGroup } from "./db-properties";
import type { RollupFn } from "./db-rollup";
import type { ViewType } from "./db-views";

/**
 * Database templates: structure (properties, views) + sample rows. Values
 * use property keys and option names; they're turned into ids when a
 * template is applied (server/databases/templates.ts). Dates are offsets in
 * days from today, so samples always look current.
 */

export type TemplateCategory = "Project management" | "Personal productivity" | "Documentation" | "Business" | "Content" | "Meetings";

export interface TemplateProperty {
  key: string;
  name: string;
  type: Exclude<PropertyType, "TITLE">;
  options?: [name: string, color: OptionColor, group?: StatusGroup][];
  numberFormat?: "number" | "comma" | "percent" | "usd" | "eur" | "gbp" | "bdt";
  range?: boolean;
  /** Default for new rows: an option name, true/false, or text. */
  default?: string | boolean | number;
  /** Relation: `to` is another database of the pack (its `ref`) or "self". */
  relation?: { to: string; limit?: "one" | "many"; pairedKey?: string; pairedName?: string };
  /** Rollup: a relation key here, a property key in the related database ("title" for the title). */
  rollup?: { relation: string; target: string; fn: RollupFn };
  formula?: string;
}

export interface TemplateView {
  name: string;
  type: ViewType;
  groupBy?: string;
  sorts?: [key: string, direction: "asc" | "desc"][];
  hidden?: string[];
  /** Simple AND filter: [key, operator, value]. */
  filter?: [key: string, operator: string, value?: string | number][];
  /** Calendar date / timeline start. */
  dateBy?: string;
  /** Timeline end (another date property). */
  endBy?: string;
  scale?: "day" | "week" | "month";
  /** "page" or a Files property key. */
  cover?: string;
  cardSize?: "small" | "medium" | "large";
}

/** Relation values are titles of rows in the related database. */
export type TemplateValue = string | number | boolean | string[] | { days: number; endDays?: number };

export interface TemplateRow {
  title: string;
  icon?: string;
  values?: Record<string, TemplateValue>;
  /** Page body: paragraphs (lines starting with "# " become headings, "- " bullets, "[ ] " to-dos). */
  body?: string[];
}

export interface DatabaseTemplate {
  key: string;
  /** Name of this database inside a pack (relations point at it). */
  ref?: string;
  name: string;
  category: TemplateCategory;
  icon: string;
  description: string;
  titleName?: string;
  properties: TemplateProperty[];
  views: TemplateView[];
  rows: TemplateRow[];
}

const STATUS: TemplateProperty["options"] = [
  ["Not started", "gray", "todo"],
  ["In progress", "blue", "in_progress"],
  ["Done", "green", "complete"],
];
const PRIORITY: TemplateProperty["options"] = [
  ["High", "red"],
  ["Medium", "yellow"],
  ["Low", "gray"],
];

export const TEMPLATES: DatabaseTemplate[] = [
  {
    key: "todo",
    name: "To-do List",
    category: "Personal productivity",
    icon: "✅",
    description: "Simple tasks with a due date and a checkbox.",
    titleName: "Task",
    properties: [
      { key: "done", name: "Done", type: "CHECKBOX" },
      { key: "due", name: "Due", type: "DATE" },
      { key: "priority", name: "Priority", type: "SELECT", options: PRIORITY },
    ],
    views: [
      { name: "To do", type: "LIST", filter: [["done", "unchecked"]], sorts: [["due", "asc"]] },
      { name: "All tasks", type: "TABLE", sorts: [["due", "asc"]] },
    ],
    rows: [
      { title: "Plan the week", values: { due: { days: 0 }, priority: "High" } },
      { title: "Reply to emails", values: { due: { days: 1 }, priority: "Medium" } },
      { title: "Read one paper", values: { due: { days: 3 }, priority: "Low" } },
      { title: "Back up laptop", values: { done: true, due: { days: -2 } } },
    ],
  },
  {
    key: "tasks",
    name: "Tasks",
    category: "Project management",
    icon: "📋",
    description: "Track work by status, priority, owner and due date — as a board or a table.",
    titleName: "Task",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: STATUS, default: "Not started" },
      { key: "priority", name: "Priority", type: "SELECT", options: PRIORITY },
      { key: "assignee", name: "Assignee", type: "PERSON" },
      { key: "due", name: "Due", type: "DATE" },
      { key: "tags", name: "Tags", type: "MULTI_SELECT", options: [["Frontend", "blue"], ["Backend", "green"], ["Research", "purple"], ["Bug", "red"]] },
      { key: "estimate", name: "Estimate (h)", type: "NUMBER" },
    ],
    views: [
      { name: "Board", type: "BOARD", groupBy: "status" },
      { name: "All tasks", type: "TABLE", sorts: [["priority", "asc"], ["due", "asc"]] },
      { name: "High priority", type: "TABLE", filter: [["priority", "is", "High"]] },
    ],
    rows: [
      { title: "Design the database schema", values: { status: "Done", priority: "High", tags: ["Backend"], due: { days: -5 }, estimate: 6 } },
      { title: "Build the table view", values: { status: "In progress", priority: "High", tags: ["Frontend"], due: { days: 2 }, estimate: 10 } },
      { title: "Write filter tests", values: { status: "In progress", priority: "Medium", tags: ["Backend"], due: { days: 4 }, estimate: 4 } },
      { title: "Research calendar libraries", values: { status: "Not started", priority: "Low", tags: ["Research"], due: { days: 10 }, estimate: 2 } },
      { title: "Fix date picker in dark mode", values: { status: "Not started", priority: "Medium", tags: ["Frontend", "Bug"], due: { days: 6 }, estimate: 1 } },
    ],
  },
  {
    key: "projects",
    name: "Projects",
    category: "Project management",
    icon: "🚀",
    description: "Projects with status, dates, owner and links.",
    titleName: "Project",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: [["Planning", "gray", "todo"], ["Active", "blue", "in_progress"], ["Paused", "yellow", "in_progress"], ["Done", "green", "complete"]], default: "Planning" },
      { key: "dates", name: "Dates", type: "DATE", range: true },
      { key: "owner", name: "Owner", type: "PERSON" },
      { key: "area", name: "Area", type: "SELECT", options: [["AI", "purple"], ["Web", "blue"], ["Research", "green"]] },
      { key: "link", name: "Link", type: "URL" },
    ],
    views: [
      { name: "Active", type: "BOARD", groupBy: "status" },
      { name: "All projects", type: "TABLE", sorts: [["dates", "desc"]] },
    ],
    rows: [
      { title: "Portfolio CMS", icon: "🗂️", values: { status: "Active", area: "Web", dates: { days: -30, endDays: 14 }, link: "https://github.com/qwertyz15/fahimworks-cms" }, body: ["# Goal", "A private CMS with a public timeline.", "# Next", "[ ] Databases phase 2", "[ ] Calendar view"] },
      { title: "Agentic AI architecture", icon: "🤖", values: { status: "Done", area: "AI", dates: { days: -90, endDays: -20 } } },
      { title: "Reading group notes", icon: "📚", values: { status: "Planning", area: "Research", dates: { days: 7, endDays: 60 } } },
    ],
  },
  {
    key: "meeting-notes",
    name: "Meeting Notes",
    category: "Meetings",
    icon: "🗓️",
    description: "One page per meeting: date, type, attendees and notes.",
    titleName: "Meeting",
    properties: [
      { key: "date", name: "Date", type: "DATE" },
      { key: "type", name: "Type", type: "SELECT", options: [["Standup", "blue"], ["Planning", "purple"], ["1:1", "green"], ["Review", "orange"]] },
      { key: "attendees", name: "Attendees", type: "PERSON" },
    ],
    views: [{ name: "All meetings", type: "TABLE", sorts: [["date", "desc"]] }, { name: "By type", type: "BOARD", groupBy: "type" }],
    rows: [
      { title: "Weekly planning", values: { date: { days: -1 }, type: "Planning" }, body: ["# Agenda", "- Review last week", "- Plan this week", "# Action items", "[ ] Share the roadmap"] },
      { title: "Design review", values: { date: { days: -3 }, type: "Review" }, body: ["# Notes", "Board view looks good; table needs keyboard navigation."] },
    ],
  },
  {
    key: "blog-planner",
    name: "Blog Planner",
    category: "Content",
    icon: "✍️",
    description: "Plan posts from idea to published.",
    titleName: "Post",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: [["Idea", "gray", "todo"], ["Drafting", "yellow", "in_progress"], ["Editing", "orange", "in_progress"], ["Published", "green", "complete"]], default: "Idea" },
      { key: "publish", name: "Publish date", type: "DATE" },
      { key: "topics", name: "Topics", type: "MULTI_SELECT", options: [["AI", "purple"], ["Web", "blue"], ["Career", "green"]] },
      { key: "words", name: "Target words", type: "NUMBER", numberFormat: "comma" },
    ],
    views: [{ name: "Pipeline", type: "BOARD", groupBy: "status" }, { name: "Schedule", type: "TABLE", sorts: [["publish", "asc"]] }],
    rows: [
      { title: "What I learned building a CMS", values: { status: "Drafting", topics: ["Web"], publish: { days: 7 }, words: 1500 } },
      { title: "RAG in practice", values: { status: "Idea", topics: ["AI"], words: 2000 } },
      { title: "Notes on agent design", values: { status: "Published", topics: ["AI"], publish: { days: -14 }, words: 1800 } },
    ],
  },
  {
    key: "crm",
    name: "CRM",
    category: "Business",
    icon: "🤝",
    description: "Contacts and deals: stage, value, company, email and phone.",
    titleName: "Contact",
    properties: [
      { key: "stage", name: "Stage", type: "STATUS", options: [["Lead", "gray", "todo"], ["Contacted", "blue", "in_progress"], ["Proposal", "purple", "in_progress"], ["Won", "green", "complete"], ["Lost", "red", "complete"]], default: "Lead" },
      { key: "company", name: "Company", type: "TEXT" },
      { key: "value", name: "Deal value", type: "NUMBER", numberFormat: "usd" },
      { key: "email", name: "Email", type: "EMAIL" },
      { key: "phone", name: "Phone", type: "PHONE" },
      { key: "next", name: "Next follow-up", type: "DATE" },
    ],
    views: [{ name: "Pipeline", type: "BOARD", groupBy: "stage" }, { name: "All contacts", type: "TABLE", sorts: [["value", "desc"]] }],
    rows: [
      { title: "Ayesha Rahman", values: { stage: "Proposal", company: "Northwind", value: 12000, email: "ayesha@northwind.example", next: { days: 2 } } },
      { title: "Daniel Kim", values: { stage: "Contacted", company: "Contoso", value: 4500, email: "daniel@contoso.example", phone: "+1 555 0142", next: { days: 5 } } },
      { title: "Maria Lopez", values: { stage: "Won", company: "Fabrikam", value: 8000, email: "maria@fabrikam.example" } },
      { title: "Tom Becker", values: { stage: "Lead", company: "Tailspin", value: 2000 } },
    ],
  },
  {
    key: "content-calendar",
    name: "Content Calendar",
    category: "Content",
    icon: "🗓️",
    description: "Plan what goes out when, across channels.",
    titleName: "Piece",
    properties: [
      { key: "publish", name: "Publish date", type: "DATE" },
      { key: "status", name: "Status", type: "STATUS", options: [["Idea", "gray", "todo"], ["Writing", "yellow", "in_progress"], ["Scheduled", "blue", "in_progress"], ["Published", "green", "complete"]], default: "Idea" },
      { key: "channel", name: "Channel", type: "SELECT", options: [["Blog", "blue"], ["Newsletter", "purple"], ["LinkedIn", "green"], ["YouTube", "red"]] },
      { key: "owner", name: "Owner", type: "PERSON" },
    ],
    views: [
      { name: "Calendar", type: "CALENDAR", dateBy: "publish" },
      { name: "Pipeline", type: "BOARD", groupBy: "status" },
      { name: "All content", type: "TABLE", sorts: [["publish", "asc"]] },
    ],
    rows: [
      { title: "Launch post: the new CMS", values: { publish: { days: 2 }, status: "Scheduled", channel: "Blog" } },
      { title: "Monthly newsletter", values: { publish: { days: 9 }, status: "Writing", channel: "Newsletter" } },
      { title: "Agents explained (video)", values: { publish: { days: 16 }, status: "Idea", channel: "YouTube" } },
      { title: "What I shipped this month", values: { publish: { days: -6 }, status: "Published", channel: "LinkedIn" } },
    ],
  },
  {
    key: "social-planner",
    name: "Social Media Planner",
    category: "Content",
    icon: "📣",
    description: "Posts per platform, on a calendar and a board.",
    titleName: "Post",
    properties: [
      { key: "date", name: "Post date", type: "DATE" },
      { key: "platform", name: "Platform", type: "MULTI_SELECT", options: [["X", "gray"], ["LinkedIn", "blue"], ["Instagram", "pink"], ["Facebook", "purple"]] },
      { key: "status", name: "Status", type: "STATUS", options: [["Draft", "gray", "todo"], ["Ready", "yellow", "in_progress"], ["Posted", "green", "complete"]], default: "Draft" },
      { key: "link", name: "Link", type: "URL" },
    ],
    views: [
      { name: "Calendar", type: "CALENDAR", dateBy: "date" },
      { name: "By status", type: "BOARD", groupBy: "status" },
    ],
    rows: [
      { title: "Teaser: databases are coming", values: { date: { days: 1 }, platform: ["X", "LinkedIn"], status: "Ready" } },
      { title: "Behind the scenes photo", values: { date: { days: 4 }, platform: ["Instagram"], status: "Draft" } },
      { title: "Case study thread", values: { date: { days: -3 }, platform: ["X"], status: "Posted", link: "https://example.com/thread" } },
    ],
  },
  {
    key: "sprint-planner",
    name: "Sprint Planner",
    category: "Project management",
    icon: "🏃",
    description: "Stories with points, sprints and dates — board, timeline and table.",
    titleName: "Story",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: STATUS, default: "Not started" },
      { key: "sprint", name: "Sprint", type: "SELECT", options: [["Sprint 1", "blue"], ["Sprint 2", "purple"], ["Sprint 3", "green"]] },
      { key: "points", name: "Points", type: "NUMBER" },
      { key: "dates", name: "Dates", type: "DATE", range: true },
      { key: "assignee", name: "Assignee", type: "PERSON" },
    ],
    views: [
      { name: "Board", type: "BOARD", groupBy: "status" },
      { name: "Timeline", type: "TIMELINE", dateBy: "dates", scale: "week" },
      { name: "By sprint", type: "TABLE", sorts: [["sprint", "asc"], ["points", "desc"]] },
    ],
    rows: [
      { title: "Calendar view", values: { status: "Done", sprint: "Sprint 1", points: 5, dates: { days: -14, endDays: -9 } } },
      { title: "Timeline drag & resize", values: { status: "In progress", sprint: "Sprint 2", points: 8, dates: { days: -3, endDays: 4 } } },
      { title: "Gallery covers", values: { status: "In progress", sprint: "Sprint 2", points: 3, dates: { days: 0, endDays: 3 } } },
      { title: "Relations and rollups", values: { status: "Not started", sprint: "Sprint 3", points: 13, dates: { days: 8, endDays: 20 } } },
    ],
  },
  {
    key: "product-roadmap",
    name: "Product Roadmap",
    category: "Project management",
    icon: "🗺️",
    description: "Features across quarters on a timeline.",
    titleName: "Feature",
    properties: [
      { key: "when", name: "When", type: "DATE", range: true },
      { key: "quarter", name: "Quarter", type: "SELECT", options: [["Q4 2026", "blue"], ["Q1 2027", "purple"], ["Q2 2027", "green"]] },
      { key: "status", name: "Status", type: "STATUS", options: [["Planned", "gray", "todo"], ["Building", "blue", "in_progress"], ["Shipped", "green", "complete"]], default: "Planned" },
      { key: "owner", name: "Owner", type: "PERSON" },
    ],
    views: [
      { name: "Timeline", type: "TIMELINE", dateBy: "when", scale: "month" },
      { name: "By quarter", type: "BOARD", groupBy: "quarter" },
      { name: "All features", type: "TABLE", sorts: [["when", "asc"]] },
    ],
    rows: [
      { title: "Workspace databases", values: { when: { days: -30, endDays: 20 }, quarter: "Q4 2026", status: "Building" } },
      { title: "Relations & formulas", values: { when: { days: 25, endDays: 70 }, quarter: "Q4 2026", status: "Planned" } },
      { title: "Sharing & comments", values: { when: { days: 90, endDays: 150 }, quarter: "Q1 2027", status: "Planned" } },
    ],
  },
  {
    key: "journal",
    name: "Journal",
    category: "Personal productivity",
    icon: "📔",
    description: "One page per day, with a mood and tags.",
    titleName: "Entry",
    properties: [
      { key: "date", name: "Date", type: "DATE" },
      { key: "mood", name: "Mood", type: "SELECT", options: [["Great", "green"], ["Good", "blue"], ["Okay", "yellow"], ["Low", "gray"]] },
      { key: "tags", name: "Tags", type: "MULTI_SELECT", options: [["Work", "blue"], ["Health", "green"], ["Ideas", "purple"]] },
    ],
    views: [
      { name: "Gallery", type: "GALLERY", cover: "page", cardSize: "medium" },
      { name: "Calendar", type: "CALENDAR", dateBy: "date" },
      { name: "All entries", type: "LIST", sorts: [["date", "desc"]] },
    ],
    rows: [
      { title: "A productive Monday", icon: "☀️", values: { date: { days: -2 }, mood: "Great", tags: ["Work"] }, body: ["Finished the calendar view and went for a run.", "# Grateful for", "- Good coffee", "- A quiet morning"] },
      { title: "Rest day", icon: "🌿", values: { date: { days: -1 }, mood: "Good", tags: ["Health"] }, body: ["Took it slow. Read two chapters."] },
      { title: "Ideas for next week", icon: "💡", values: { date: { days: 0 }, mood: "Okay", tags: ["Ideas"] }, body: ["[ ] Try the timeline for planning", "[ ] Write about databases"] },
    ],
  },
  {
    key: "habit-tracker",
    name: "Habit Tracker",
    category: "Personal productivity",
    icon: "🔁",
    description: "Tick off habits each day; see them on a calendar.",
    titleName: "Day",
    properties: [
      { key: "date", name: "Date", type: "DATE" },
      { key: "exercise", name: "Exercise", type: "CHECKBOX" },
      { key: "read", name: "Read", type: "CHECKBOX" },
      { key: "meditate", name: "Meditate", type: "CHECKBOX" },
      { key: "water", name: "Water (glasses)", type: "NUMBER" },
    ],
    views: [
      { name: "This month", type: "CALENDAR", dateBy: "date" },
      { name: "Log", type: "TABLE", sorts: [["date", "desc"]] },
    ],
    rows: [
      { title: "Today", values: { date: { days: 0 }, exercise: true, read: false, meditate: true, water: 6 } },
      { title: "Yesterday", values: { date: { days: -1 }, exercise: true, read: true, meditate: true, water: 8 } },
      { title: "Two days ago", values: { date: { days: -2 }, exercise: false, read: true, meditate: false, water: 5 } },
    ],
  },
  {
    key: "goal-tracker",
    name: "Goal Tracker",
    category: "Personal productivity",
    icon: "🎯",
    description: "Goals with a target date and progress.",
    titleName: "Goal",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: [["Not started", "gray", "todo"], ["On track", "blue", "in_progress"], ["At risk", "orange", "in_progress"], ["Achieved", "green", "complete"]], default: "Not started" },
      { key: "period", name: "Period", type: "DATE", range: true },
      { key: "progress", name: "Progress", type: "NUMBER", numberFormat: "percent" },
      { key: "area", name: "Area", type: "SELECT", options: [["Career", "blue"], ["Health", "green"], ["Learning", "purple"]] },
    ],
    views: [
      { name: "Timeline", type: "TIMELINE", dateBy: "period", scale: "month" },
      { name: "Board", type: "BOARD", groupBy: "status" },
      { name: "Gallery", type: "GALLERY", cover: "page", cardSize: "small" },
    ],
    rows: [
      { title: "Ship databases phase 2", icon: "🚀", values: { status: "On track", period: { days: -10, endDays: 20 }, progress: 0.6, area: "Career" } },
      { title: "Run 10 km", icon: "🏃", values: { status: "At risk", period: { days: -40, endDays: 30 }, progress: 0.35, area: "Health" } },
      { title: "Read 12 books", icon: "📚", values: { status: "On track", period: { days: -200, endDays: 90 }, progress: 0.7, area: "Learning" } },
    ],
  },
  {
    key: "document-hub",
    name: "Document Hub",
    category: "Documentation",
    icon: "🗂️",
    description: "Guides, policies and references in one place, linked to each other.",
    titleName: "Document",
    properties: [
      { key: "type", name: "Type", type: "SELECT", options: [["Guide", "blue"], ["Policy", "purple"], ["Reference", "green"], ["How-to", "orange"]] },
      { key: "status", name: "Status", type: "STATUS", options: [["Draft", "gray", "todo"], ["In review", "yellow", "in_progress"], ["Published", "green", "complete"]], default: "Draft" },
      { key: "owner", name: "Owner", type: "PERSON" },
      { key: "related", name: "Related", type: "RELATION", relation: { to: "self", pairedKey: "relatedFrom", pairedName: "Linked from" } },
      { key: "edited", name: "Last edited", type: "LAST_EDITED_TIME" },
    ],
    views: [
      { name: "All documents", type: "TABLE", sorts: [["edited", "desc"]] },
      { name: "By type", type: "BOARD", groupBy: "type" },
      { name: "Published", type: "LIST", filter: [["status", "is", "Published"]] },
    ],
    rows: [
      { title: "Onboarding guide", icon: "👋", values: { type: "Guide", status: "Published", related: ["Code of conduct", "Tooling reference"] }, body: ["# Your first week", "- Set up your laptop", "- Read the code of conduct", "[ ] Meet your buddy"] },
      { title: "Code of conduct", icon: "🤝", values: { type: "Policy", status: "Published" }, body: ["Be kind, be clear, assume good intent."] },
      { title: "Tooling reference", icon: "🧰", values: { type: "Reference", status: "In review" }, body: ["Editors, linters and the deploy pipeline."] },
      { title: "How to request access", icon: "🔑", values: { type: "How-to", status: "Draft", related: ["Tooling reference"] } },
    ],
  },
  {
    key: "engineering-docs",
    name: "Engineering Docs",
    category: "Documentation",
    icon: "🛠️",
    description: "RFCs, ADRs, runbooks and specs with their dependencies.",
    titleName: "Doc",
    properties: [
      { key: "type", name: "Type", type: "SELECT", options: [["RFC", "blue"], ["ADR", "purple"], ["Runbook", "orange"], ["Spec", "green"]] },
      { key: "status", name: "Status", type: "STATUS", options: [["Draft", "gray", "todo"], ["In review", "yellow", "in_progress"], ["Accepted", "green", "complete"], ["Deprecated", "red", "complete"]], default: "Draft" },
      { key: "owner", name: "Owner", type: "PERSON" },
      { key: "depends", name: "Depends on", type: "RELATION", relation: { to: "self", pairedKey: "neededBy", pairedName: "Needed by" } },
      { key: "blockers", name: "Dependencies", type: "ROLLUP", rollup: { relation: "depends", target: "title", fn: "count_all" } },
      { key: "edited", name: "Last edited", type: "LAST_EDITED_TIME" },
    ],
    views: [
      { name: "All docs", type: "TABLE" },
      { name: "By status", type: "BOARD", groupBy: "status" },
      { name: "Runbooks", type: "LIST", filter: [["type", "is", "Runbook"]] },
    ],
    rows: [
      { title: "RFC: Workspace databases", icon: "📐", values: { type: "RFC", status: "Accepted" }, body: ["# Problem", "Content lives in too many places.", "# Proposal", "Rows are pages; views are saved queries."] },
      { title: "ADR: JSONB for property values", values: { type: "ADR", status: "Accepted", depends: ["RFC: Workspace databases"] } },
      { title: "Spec: Relations and rollups", values: { type: "Spec", status: "In review", depends: ["RFC: Workspace databases", "ADR: JSONB for property values"] } },
      { title: "Runbook: Restore the database", icon: "🚨", values: { type: "Runbook", status: "Draft" }, body: ["[ ] Stop writes", "[ ] Restore the latest snapshot", "[ ] Verify row counts"] },
    ],
  },
  {
    key: "knowledge-base",
    name: "Knowledge Base",
    category: "Documentation",
    icon: "📖",
    description: "Answers people can find, with verified articles and see-also links.",
    titleName: "Article",
    properties: [
      { key: "category", name: "Category", type: "SELECT", options: [["Getting started", "green"], ["Account", "blue"], ["Billing", "purple"], ["Troubleshooting", "orange"]] },
      { key: "tags", name: "Tags", type: "MULTI_SELECT", options: [["FAQ", "blue"], ["Video", "red"], ["Advanced", "gray"]] },
      { key: "verified", name: "Verified", type: "CHECKBOX" },
      { key: "see", name: "See also", type: "RELATION", relation: { to: "self" } },
      { key: "edited", name: "Last edited", type: "LAST_EDITED_TIME" },
    ],
    views: [
      { name: "By category", type: "BOARD", groupBy: "category" },
      { name: "All articles", type: "TABLE" },
      { name: "Needs review", type: "LIST", filter: [["verified", "unchecked"]] },
    ],
    rows: [
      { title: "Create your account", values: { category: "Getting started", tags: ["FAQ"], verified: true, see: ["Reset your password"] }, body: ["Sign up with your email, then confirm it."] },
      { title: "Reset your password", values: { category: "Account", tags: ["FAQ"], verified: true } },
      { title: "Update billing details", values: { category: "Billing", verified: false, see: ["Create your account"] } },
      { title: "Pages load slowly", values: { category: "Troubleshooting", tags: ["Advanced"], verified: false } },
    ],
  },
  {
    key: "brainstorm",
    name: "Brainstorm Session",
    category: "Meetings",
    icon: "💡",
    description: "Collect ideas, vote, and let a score rank them by votes and effort.",
    titleName: "Idea",
    properties: [
      { key: "status", name: "Status", type: "STATUS", options: [["New", "gray", "todo"], ["Exploring", "blue", "in_progress"], ["Chosen", "green", "complete"], ["Parked", "brown", "complete"]], default: "New" },
      { key: "votes", name: "Votes", type: "NUMBER", default: 0 },
      { key: "effort", name: "Effort (1–5)", type: "NUMBER" },
      { key: "score", name: "Score", type: "FORMULA", formula: 'round(prop("Votes") / max(prop("Effort (1–5)"), 1), 1)' },
      { key: "by", name: "Suggested by", type: "PERSON" },
    ],
    views: [
      { name: "Ranked", type: "TABLE", sorts: [["score", "desc"]] },
      { name: "Board", type: "BOARD", groupBy: "status" },
    ],
    rows: [
      { title: "Weekly demo day", values: { status: "Exploring", votes: 7, effort: 2 } },
      { title: "Public roadmap page", values: { status: "New", votes: 5, effort: 3 } },
      { title: "Dark mode for the timeline", values: { status: "Chosen", votes: 9, effort: 1 } },
      { title: "Rewrite in Rust", values: { status: "Parked", votes: 2, effort: 5 } },
    ],
  },
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Project management", "Personal productivity", "Documentation", "Business", "Content", "Meetings"];

/** Several linked databases created together (relations between them). The first one opens. */
export interface TemplatePack {
  key: string;
  name: string;
  category: TemplateCategory;
  icon: string;
  description: string;
  databases: (DatabaseTemplate & { ref: string })[];
}

export const PACKS: TemplatePack[] = [
  {
    key: "projects-tasks",
    name: "Projects & Tasks",
    category: "Project management",
    icon: "🗺️",
    description: "Projects with their tasks linked: progress, open tasks and days left update themselves.",
    databases: [
      {
        key: "projects-tasks:projects",
        ref: "projects",
        name: "Projects",
        category: "Project management",
        icon: "🗺️",
        description: "Projects, with progress rolled up from their tasks.",
        titleName: "Project",
        properties: [
          { key: "status", name: "Status", type: "STATUS", options: [["Planning", "gray", "todo"], ["Active", "blue", "in_progress"], ["Done", "green", "complete"]], default: "Planning" },
          { key: "due", name: "Due", type: "DATE" },
          { key: "tasks", name: "Tasks", type: "RELATION", relation: { to: "tasks", pairedKey: "project", pairedName: "Project" } },
          { key: "progress", name: "Progress", type: "ROLLUP", rollup: { relation: "tasks", target: "status", fn: "percent_complete" } },
          { key: "count", name: "Task count", type: "ROLLUP", rollup: { relation: "tasks", target: "title", fn: "count_all" } },
          { key: "open", name: "Open tasks", type: "FORMULA", formula: 'round(prop("Task count") * (1 - prop("Progress")))' },
          { key: "left", name: "Days left", type: "FORMULA", formula: 'dateBetween(prop("Due"), today(), "days")' },
        ],
        views: [
          { name: "All projects", type: "TABLE" },
          { name: "Board", type: "BOARD", groupBy: "status" },
        ],
        rows: [
          { title: "Website relaunch", icon: "🌐", values: { status: "Active", due: { days: 21 }, tasks: ["Design the homepage", "Write copy", "Set up analytics"] } },
          { title: "Mobile app", icon: "📱", values: { status: "Planning", due: { days: 60 }, tasks: ["Pick a framework", "Sketch onboarding"] } },
          { title: "Q3 report", icon: "📊", values: { status: "Done", due: { days: -5 }, tasks: ["Collect numbers", "Write summary"] } },
        ],
      },
      {
        key: "projects-tasks:tasks",
        ref: "tasks",
        name: "Tasks",
        category: "Project management",
        icon: "✅",
        description: "Tasks, each linked to its project.",
        titleName: "Task",
        properties: [
          { key: "status", name: "Status", type: "STATUS", options: STATUS, default: "Not started" },
          { key: "priority", name: "Priority", type: "SELECT", options: PRIORITY },
          { key: "due", name: "Due", type: "DATE" },
          { key: "estimate", name: "Estimate (h)", type: "NUMBER" },
        ],
        views: [
          { name: "Board", type: "BOARD", groupBy: "status" },
          { name: "All tasks", type: "TABLE" },
          { name: "Calendar", type: "CALENDAR", dateBy: "due" },
        ],
        rows: [
          { title: "Design the homepage", values: { status: "Done", priority: "High", due: { days: -3 }, estimate: 8 } },
          { title: "Write copy", values: { status: "In progress", priority: "Medium", due: { days: 4 }, estimate: 5 } },
          { title: "Set up analytics", values: { status: "Not started", priority: "Low", due: { days: 10 }, estimate: 2 } },
          { title: "Pick a framework", values: { status: "In progress", priority: "High", due: { days: 7 }, estimate: 3 } },
          { title: "Sketch onboarding", values: { status: "Not started", priority: "Medium", due: { days: 14 }, estimate: 6 } },
          { title: "Collect numbers", values: { status: "Done", priority: "High", due: { days: -12 }, estimate: 4 } },
          { title: "Write summary", values: { status: "Done", priority: "Medium", due: { days: -6 }, estimate: 3 } },
        ],
      },
    ],
  },
  {
    key: "sales-pipeline",
    name: "Sales Pipeline",
    category: "Business",
    icon: "💼",
    description: "Deals linked to companies: weighted value per deal, pipeline total per company.",
    databases: [
      {
        key: "sales-pipeline:deals",
        ref: "deals",
        name: "Deals",
        category: "Business",
        icon: "💼",
        description: "Open and closed deals.",
        titleName: "Deal",
        properties: [
          { key: "stage", name: "Stage", type: "STATUS", options: [["Lead", "gray", "todo"], ["Qualified", "blue", "in_progress"], ["Proposal", "purple", "in_progress"], ["Won", "green", "complete"], ["Lost", "red", "complete"]], default: "Lead" },
          { key: "value", name: "Value", type: "NUMBER", numberFormat: "usd" },
          { key: "probability", name: "Probability", type: "NUMBER", numberFormat: "percent" },
          { key: "close", name: "Close date", type: "DATE" },
          { key: "company", name: "Company", type: "RELATION", relation: { to: "companies", limit: "one", pairedKey: "deals", pairedName: "Deals" } },
          { key: "weighted", name: "Weighted value", type: "FORMULA", formula: 'prop("Value") * prop("Probability")', numberFormat: "usd" },
        ],
        views: [
          { name: "Pipeline", type: "BOARD", groupBy: "stage" },
          { name: "All deals", type: "TABLE", sorts: [["weighted", "desc"]] },
          { name: "Closing", type: "CALENDAR", dateBy: "close" },
        ],
        rows: [
          { title: "Annual licence", values: { stage: "Proposal", value: 24000, probability: 0.6, close: { days: 14 }, company: ["Northwind"] } },
          { title: "Pilot project", values: { stage: "Qualified", value: 8000, probability: 0.3, close: { days: 30 }, company: ["Globex"] } },
          { title: "Support renewal", values: { stage: "Won", value: 6000, probability: 1, close: { days: -7 }, company: ["Northwind"] } },
          { title: "Team expansion", values: { stage: "Lead", value: 15000, probability: 0.1, close: { days: 45 }, company: ["Initech"] } },
        ],
      },
      {
        key: "sales-pipeline:companies",
        ref: "companies",
        name: "Companies",
        category: "Business",
        icon: "🏢",
        description: "Accounts and their pipeline.",
        titleName: "Company",
        properties: [
          { key: "industry", name: "Industry", type: "SELECT", options: [["Software", "blue"], ["Retail", "orange"], ["Finance", "green"]] },
          { key: "website", name: "Website", type: "URL" },
          { key: "total", name: "Pipeline total", type: "ROLLUP", rollup: { relation: "deals", target: "value", fn: "sum" } },
          { key: "weighted", name: "Weighted total", type: "ROLLUP", rollup: { relation: "deals", target: "weighted", fn: "sum" } },
          { key: "count", name: "Deals count", type: "ROLLUP", rollup: { relation: "deals", target: "title", fn: "count_all" } },
        ],
        views: [{ name: "All companies", type: "TABLE", sorts: [["total", "desc"]] }],
        rows: [
          { title: "Northwind", values: { industry: "Retail", website: "https://northwind.example" } },
          { title: "Globex", values: { industry: "Software", website: "https://globex.example" } },
          { title: "Initech", values: { industry: "Finance" } },
        ],
      },
    ],
  },
  {
    key: "customer-management",
    name: "Customer Management",
    category: "Business",
    icon: "🧑‍💼",
    description: "Customers and their orders: lifetime value and days since the last order.",
    databases: [
      {
        key: "customer-management:customers",
        ref: "customers",
        name: "Customers",
        category: "Business",
        icon: "🧑‍💼",
        description: "People and companies you sell to.",
        titleName: "Customer",
        properties: [
          { key: "email", name: "Email", type: "EMAIL" },
          { key: "tier", name: "Tier", type: "SELECT", options: [["Gold", "yellow"], ["Silver", "gray"], ["New", "green"]] },
          { key: "ltv", name: "Lifetime value", type: "ROLLUP", rollup: { relation: "orders", target: "amount", fn: "sum" } },
          { key: "last", name: "Last order", type: "ROLLUP", rollup: { relation: "orders", target: "date", fn: "latest" } },
          { key: "since", name: "Days since last order", type: "FORMULA", formula: 'dateBetween(today(), prop("Last order"), "days")' },
        ],
        views: [
          { name: "All customers", type: "TABLE", sorts: [["ltv", "desc"]] },
          { name: "By tier", type: "BOARD", groupBy: "tier" },
        ],
        rows: [
          { title: "Ada Lovelace", values: { email: "ada@example.com", tier: "Gold" } },
          { title: "Grace Hopper", values: { email: "grace@example.com", tier: "Silver" } },
          { title: "Alan Turing", values: { email: "alan@example.com", tier: "New" } },
        ],
      },
      {
        key: "customer-management:orders",
        ref: "orders",
        name: "Orders",
        category: "Business",
        icon: "🧾",
        description: "Orders, each for one customer.",
        titleName: "Order",
        properties: [
          { key: "date", name: "Date", type: "DATE" },
          { key: "amount", name: "Amount", type: "NUMBER", numberFormat: "usd" },
          { key: "status", name: "Status", type: "SELECT", options: [["Paid", "green"], ["Pending", "yellow"], ["Refunded", "red"]] },
          { key: "customer", name: "Customer", type: "RELATION", relation: { to: "customers", limit: "one", pairedKey: "orders", pairedName: "Orders" } },
        ],
        views: [
          { name: "All orders", type: "TABLE", sorts: [["date", "desc"]] },
          { name: "Calendar", type: "CALENDAR", dateBy: "date" },
        ],
        rows: [
          { title: "#1001", values: { date: { days: -40 }, amount: 320, status: "Paid", customer: ["Ada Lovelace"] } },
          { title: "#1002", values: { date: { days: -12 }, amount: 180, status: "Paid", customer: ["Ada Lovelace"] } },
          { title: "#1003", values: { date: { days: -3 }, amount: 95, status: "Pending", customer: ["Grace Hopper"] } },
          { title: "#1004", values: { date: { days: -60 }, amount: 540, status: "Paid", customer: ["Grace Hopper"] } },
        ],
      },
    ],
  },
  {
    key: "inventory",
    name: "Inventory",
    category: "Business",
    icon: "📦",
    description: "Products and suppliers: stock value, reorder flags and stock per supplier.",
    databases: [
      {
        key: "inventory:products",
        ref: "products",
        name: "Products",
        category: "Business",
        icon: "📦",
        description: "What you stock.",
        titleName: "Product",
        properties: [
          { key: "sku", name: "SKU", type: "TEXT" },
          { key: "qty", name: "Qty", type: "NUMBER" },
          { key: "min", name: "Min stock", type: "NUMBER" },
          { key: "price", name: "Unit price", type: "NUMBER", numberFormat: "usd" },
          { key: "supplier", name: "Supplier", type: "RELATION", relation: { to: "suppliers", limit: "one", pairedKey: "products", pairedName: "Products" } },
          { key: "value", name: "Stock value", type: "FORMULA", formula: 'prop("Qty") * prop("Unit price")', numberFormat: "usd" },
          { key: "reorder", name: "Reorder?", type: "FORMULA", formula: 'prop("Qty") < prop("Min stock")' },
        ],
        views: [
          { name: "All products", type: "TABLE" },
          { name: "Reorder", type: "TABLE", filter: [["reorder", "checked"]] },
        ],
        rows: [
          { title: "USB-C cable", values: { sku: "CAB-01", qty: 140, min: 50, price: 6.5, supplier: ["Cable Co"] } },
          { title: "Laptop stand", values: { sku: "STD-02", qty: 8, min: 15, price: 34, supplier: ["DeskWorks"] } },
          { title: "Monitor arm", values: { sku: "ARM-03", qty: 22, min: 10, price: 79, supplier: ["DeskWorks"] } },
          { title: "HDMI adapter", values: { sku: "ADP-04", qty: 3, min: 20, price: 12, supplier: ["Cable Co"] } },
        ],
      },
      {
        key: "inventory:suppliers",
        ref: "suppliers",
        name: "Suppliers",
        category: "Business",
        icon: "🚚",
        description: "Who you buy from.",
        titleName: "Supplier",
        properties: [
          { key: "email", name: "Email", type: "EMAIL" },
          { key: "country", name: "Country", type: "SELECT", options: [["Bangladesh", "green"], ["Germany", "gray"], ["Japan", "red"]] },
          { key: "count", name: "Product count", type: "ROLLUP", rollup: { relation: "products", target: "title", fn: "count_all" } },
          { key: "stock", name: "Stock value", type: "ROLLUP", rollup: { relation: "products", target: "value", fn: "sum" } },
        ],
        views: [{ name: "All suppliers", type: "TABLE" }],
        rows: [
          { title: "Cable Co", values: { email: "orders@cable.example", country: "Japan" } },
          { title: "DeskWorks", values: { email: "sales@deskworks.example", country: "Germany" } },
        ],
      },
    ],
  },
];
