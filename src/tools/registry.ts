/**
 * Thin wrapper over `McpServer.registerTool` that gives every tool the same
 * error handling, so a failed API call becomes a readable message instead of a
 * protocol-level exception.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { formatToolError } from "../errors.js";
import type { ToolResult } from "../format.js";

export type Shape = Record<string, z.ZodType>;

type InferShape<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

export interface ToolDefinition<I extends Shape, O extends Shape> {
    title: string;
    description: string;
    inputSchema: I;
    outputSchema: O;
    annotations: ToolAnnotations;
}

export function defineTool<I extends Shape, O extends Shape>(
    server: McpServer,
    name: string,
    definition: ToolDefinition<I, O>,
    handler: (args: InferShape<I>) => Promise<ToolResult>
): void {
    server.registerTool(name, definition, (async (args: InferShape<I>) => {
        try {
            return await handler(args);
        } catch (error) {
            return {
                content: [{ type: "text" as const, text: formatToolError(error) }],
                isError: true
            };
        }
    }) as never);
}
