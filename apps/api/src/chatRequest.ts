import { z } from "zod";

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  documentIds: z.array(z.string().uuid()).min(1).max(50).optional(),
});
