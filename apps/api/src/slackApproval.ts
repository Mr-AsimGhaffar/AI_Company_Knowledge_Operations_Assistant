import { z } from "zod";

const text = z.string().min(1).max(3000);

export const preparedSlackMessageSchema = z.union([
  z.object({
    text,
    channel: z.string().regex(/^[CGD][A-Z0-9]+$/),
  }).strict(),
  z.object({
    text,
    recipientId: z.string().regex(/^[UW][A-Z0-9]+$/),
    recipientDisplayName: z.string().min(1),
    recipientUsername: z.string().min(1).optional(),
  }).strict(),
]);
