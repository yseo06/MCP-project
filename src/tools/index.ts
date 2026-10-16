import type { ToolDef } from "./types.js";
import { fileTools } from "./files.js";
import { searchTools } from "./search.js";
import { gitTools } from "./git.js";
import { handoffTools } from "./handoff.js";

export const ALL_TOOLS: ToolDef[] = [...fileTools, ...searchTools, ...gitTools, ...handoffTools];
