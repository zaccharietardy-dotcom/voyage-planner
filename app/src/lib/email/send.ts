import { Resend } from 'resend';

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not configured');
    resendInstance = new Resend(key);
  }
  return resendInstance;
}

const FROM = 'Narae Voyage <noreply@naraevoyage.com>';

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      console.error('[email] Send failed:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] Send error:', err);
    return { success: false, error: String(err) };
  }
}
