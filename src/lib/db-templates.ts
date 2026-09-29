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
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["Project management", "Personal productivity", "Documentation", "Business", "Content", "Meetings"];
