import { Resend } from 'resend';
import type { EmailMessage, EmailPort } from '@kinetic/core';

export class ResendEmailAdapter implements EmailPort {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send(
      {
        from: message.from ?? this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (error) throw new Error(`Resend rejected email: ${error.name}: ${error.message}`);
  }
}
