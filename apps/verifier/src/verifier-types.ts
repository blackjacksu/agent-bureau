import type { z } from "zod";
import type { LiveCheckOutputSchema } from "@agentmap/contracts";
export type LiveCheckOutput = z.infer<typeof LiveCheckOutputSchema>;
