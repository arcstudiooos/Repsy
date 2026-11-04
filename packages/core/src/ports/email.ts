/** A fully rendered email, addressed to a concrete recipient. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  templateKey: string;
  payload: Record<string, unknown>;
  /** Stable per outbox row; adapters pass it to providers that dedupe on it. */
  idempotencyKey: string;
}

export interface EmailPort {
  /** Resolves when the provider accepted the message; rejects otherwise. */
  send(message: EmailMessage): Promise<void>;
}
