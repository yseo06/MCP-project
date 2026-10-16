import type { z } from "zod";
import type { Config, Role } from "../config.js";

export type Access = "read" | "write" | "admin";

export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape, e.g. { path: z.string() } */
  inputSchema: Record<string, z.ZodTypeAny>;
  access: Access;
  handler: (args: any, ctx: ToolContext) => Promise<string> | string;
}

export interface ToolContext {
  config: Config;
  role: Role;
}

/** Which roles may use which access level. Destructive tools are admin-only. */
export const ROLE_ACCESS: Record<Role, Access[]> = {
  reader: ["read"],
  worker: ["read", "write"],
  admin: ["read", "write", "admin"],
};
