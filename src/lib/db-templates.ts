import type { OptionColor, PropertyType, StatusGroup } from "./db-properties";
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
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Project management", "Personal productivity", "Documentation", "Business", "Content", "Meetings"];
