export interface ServerConfig {
  pdfPath: string;
  notesPath: string;
  port: number;
  timerMinutes?: number;
}

export interface StartedServer {
  port: number;
  stop: () => Promise<void>;
}

export interface NotesDoc {
  meta: {
    pdf?: string;
    totalSlides?: number;
    generatedAt?: string;
    generator?: string;
  };
  notes: Record<string, { hint?: string; note?: string }>;
}

/**
 * Each route module returns `"handled"` if it wrote a response, or `"pass"`
 * if none of its patterns matched the URL/method. The main handler in
 * server.ts chains route modules and falls through to 404 on final `"pass"`.
 */
export type RouteResult = "handled" | "pass";
