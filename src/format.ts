/**
 * Response shaping shared by every tool.
 *
 * Tools build a structured object (which becomes `structuredContent`) plus a
 * markdown renderer. `buildToolResult` picks the requested representation,
 * enforces CHARACTER_LIMIT, and shortens the designated list when a response
 * would otherwise be too large for the model's context.
 */

import { z } from "zod";
import { CHARACTER_LIMIT } from "./constants.js";

export const ResponseFormatSchema = z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("Output format: 'markdown' for a compact human-readable summary, 'json' for the complete raw payload.");

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    structuredContent: Record<string, unknown>;
    isError?: boolean;
}

/** Renders `null`/`undefined` as an em dash so empty cells stay visible. */
export function show(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
}

interface Column<T> {
    header: string;
    get: (row: T) => unknown;
}

export function mdTable<T>(columns: Array<Column<T>>, rows: readonly T[]): string {
    if (rows.length === 0) return "_(none)_";
    const head = `| ${columns.map((c) => c.header).join(" | ")} |`;
    const rule = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) => `| ${columns.map((c) => show(c.get(row)).replace(/\|/g, "\\|")).join(" | ")} |`);
    return [head, rule, ...body].join("\n");
}

/** Renders a plain object as a `- **key**: value` bullet list, recursing into nested objects. */
export function mdFields(value: unknown, indent = 0): string {
    const pad = "  ".repeat(indent);

    if (value === null || value === undefined) return `${pad}—`;

    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}_(none)_`;
        return value.map((entry) => (isPlainObject(entry) ? `${pad}-\n${mdFields(entry, indent + 1)}` : `${pad}- ${show(entry)}`)).join("\n");
    }

    if (isPlainObject(value)) {
        return Object.entries(value)
            .map(([key, entry]) => {
                if (isPlainObject(entry) || (Array.isArray(entry) && entry.length > 0)) {
                    return `${pad}- **${key}**:\n${mdFields(entry, indent + 1)}`;
                }
                return `${pad}- **${key}**: ${show(entry)}`;
            })
            .join("\n");
    }

    return `${pad}${show(value)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BuildResultOptions<T extends Record<string, unknown>> {
    format: ResponseFormat;
    /** Payload returned as `structuredContent`; must be a JSON object. */
    structured: T;
    /** Markdown rendering of the (possibly shortened) payload. */
    renderMarkdown: (data: T) => string;
    /**
     * Key of an array property that may be shortened when the rendered response
     * exceeds CHARACTER_LIMIT. Omit for responses of bounded size.
     */
    truncatableKey?: Extract<keyof T, string>;
    /** Hint appended to the truncation notice, e.g. how to page for the rest. */
    truncationHint?: string;
}

export function buildToolResult<T extends Record<string, unknown>>(options: BuildResultOptions<T>): ToolResult {
    const { format, renderMarkdown, truncatableKey, truncationHint } = options;
    let structured: T = options.structured;

    const render = (data: T): string => (format === "json" ? JSON.stringify(data, null, 2) : renderMarkdown(data));

    let text = render(structured);

    // Halve the truncatable list until the response fits, keeping the newest/first entries.
    while (text.length > CHARACTER_LIMIT && truncatableKey) {
        const items = structured[truncatableKey];
        if (!Array.isArray(items) || items.length <= 1) break;

        const kept = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
        structured = {
            ...structured,
            [truncatableKey]: kept,
            truncated: true,
            truncation_message:
                `Response truncated from ${items.length} to ${kept.length} items to fit the context limit.` +
                (truncationHint ? ` ${truncationHint}` : "")
        } as T;
        text = render(structured);
    }

    // Last resort for responses with no truncatable list.
    if (text.length > CHARACTER_LIMIT) {
        text = `${text.slice(0, CHARACTER_LIMIT)}\n\n… response truncated at ${CHARACTER_LIMIT} characters. Request fewer items or use filters.`;
    }

    return {
        content: [{ type: "text", text }],
        structuredContent: structured
    };
}

/** Convenience for a heading + body markdown block. */
export function section(title: string, body: string): string {
    return `# ${title}\n\n${body}`;
}
