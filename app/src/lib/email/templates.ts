const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://naraevoyage.com';

function layout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f4f4f5;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#0f2744 100%);padding:30px;border-radius:16px 16px 0 0;text-align:center;">
    <h1 style="color:#f4d03f;margin:0;font-size:24px;font-weight:600;">Narae Voyage</h1>
  </div>
  <div style="background:white;padding:40px 30px;border-radius:0 0 16px 16px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
    ${content}
  </div>
  <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:24px;">
    © 2026 Narae Voyage. Tous droits réservés.<br/>
    <a href="${SITE_URL}/preferences" style="color:#9ca3af;">Gérer mes notifications</a>
  </p>
</div>
</body>
</html>`;
}

function button(href: string, text: string): string {
  return `<div style="text-align:center;margin:32px 0;">
  <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#c5a059 0%,#a8863a 100%);color:#020617;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:16px;">
    ${text}
  </a>
</div>`;
}

export function tripReadyEmail(tripId: string, destination: string, startDate: string, durationDays: number): { subject: string; html: string } {
  return {
    subject: `Votre voyage à ${destination} est prêt !`,
    html: layout(`
      <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">
        Votre itinéraire est prêt !
      </h2>
      <p style="color:#6b7280;font-size:16px;line-height:1.6;margin:0 0 8px;">
        Votre voyage de <strong>${durationDays} jours à ${destination}</strong> a été généré avec succès.
      </p>
      <p style="color:#6b7280;font-size:16px;line-height:1.6;margin:0 0 24px;">
        Départ le <strong>${startDate}</strong>. Activités, restaurants et hébergement sont planifiés — il ne reste plus qu'à partir !
      </p>
      ${button(`${SITE_URL}/trip/${tripId}`, 'Voir mon itinéraire')}
      <p style="color:#9ca3af;font-size:14px;text-align:center;">
        Vous pouvez modifier votre voyage à tout moment depuis l'application.
      </p>
    `),
  };
}

export function collaborationInviteEmail(inviterName: string, tripDestination: string, inviteLink: string): { subject: string; html: string } {
  return {
    subject: `${inviterName} vous invite à planifier un voyage à ${tripDestination}`,
    html: layout(`
      <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">
        Invitation à collaborer
      </h2>
      <p style="color:#6b7280;font-size:16px;line-height:1.6;margin:0 0 24px;">
        <strong>${inviterName}</strong> vous invite à rejoindre la planification d'un voyage à <strong>${tripDestination}</strong>.
      </p>
      ${button(inviteLink, 'Rejoindre le voyage')}
      <p style="color:#9ca3af;font-size:14px;text-align:center;">
        Vous pourrez proposer des modifications et voter sur les activités.
      </p>
    `),
  };
}

export function departureReminderEmail(tripId: string, destination: string, daysUntil: number): { subject: string; html: string } {
  const urgency = daysUntil <= 1 ? "C'est demain !" : `Plus que ${daysUntil} jours`;
  return {
    subject: `${urgency} — Voyage à ${destination}`,
    html: layout(`
      <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">
        ${urgency}
      </h2>
      <p style="color:#6b7280;font-size:16px;line-height:1.6;margin:0 0 24px;">
        Votre voyage à <strong>${destination}</strong> approche. Pensez à vérifier votre checklist et vos réservations.
      </p>
      ${button(`${SITE_URL}/trip/${tripId}`, 'Voir mon voyage')}
    `),
  };
}
