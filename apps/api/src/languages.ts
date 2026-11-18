import { z } from 'zod';

export const languageSchema=z.enum(['uz','tk','en','ru','ko','zh']);
export type Language=z.infer<typeof languageSchema>;

export function resolveLanguage(value?:string):Language {
  const parsed=languageSchema.safeParse(value?.toLowerCase().split(/[-_]/,1)[0]);
  return parsed.success?parsed.data:'en';
}
