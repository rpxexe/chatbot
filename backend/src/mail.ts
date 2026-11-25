// Email through Resend (https://resend.com/docs/api-reference/emails/send-email). Off when RESEND_API_KEY is unset.
// Sending never fails the request that caused it: the ticket is already saved, so an email problem is only logged.

const FROM = () => process.env.RESEND_FROM || "Footnote <onboarding@resend.dev>";

type Mail = { to: string; subject: string; text: string; html: string; replyTo?: string };

/** true when Resend accepted the email. */
export async function sendMail({ to, subject, text, html, replyTo }: Mail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  // NODE_TEST_CONTEXT: set by `node --test`, so the test suite never emails its made-up addresses.
  if (!key || process.env.NODE_TEST_CONTEXT) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    console.error(`email to ${to} failed: ${res.status} ${await res.text()}`);
  } catch (e) {
    console.error(`email to ${to} failed: ${(e as Error).message}`);
  }
  return false;
}

// ---------- layout ----------
// Email clients ignore <style> blocks and modern CSS, so: one centred table, inline styles, system fonts.
// Colors are the app's brand green (globals.css --brand, light theme).

const BRAND = "#1f6b4a";
const INK = "#18181b";
const MUTED = "#71717a";
const LINE = "#e4e4e7";
const SOFT = "#f4f4f5";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Everything a visitor typed passes through here: their text must never become markup. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Escaped, with line breaks kept. */
const para = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

function layout({ preheader, eyebrow, title, body, footer }: { preheader: string; eyebrow: string; title: string; body: string; footer: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${SOFT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 16px;font:600 15px/1 ${FONT};color:${INK};">
        <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${BRAND};margin-right:8px;vertical-align:0;"></span>Footnote
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:4px;background:${BRAND};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:28px 32px 8px;">
            <p style="margin:0 0 6px;font:500 12px/1.4 ${FONT};letter-spacing:.02em;color:${BRAND};">${esc(eyebrow)}</p>
            <h1 style="margin:0;font:600 20px/1.35 ${FONT};color:${INK};">${esc(title)}</h1>
          </td></tr>
          <tr><td style="padding:12px 32px 32px;font:400 15px/1.6 ${FONT};color:${INK};">${body}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 4px 0;font:400 12px/1.6 ${FONT};color:${MUTED};">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

const quote = (html: string) =>
  `<div style="margin:16px 0;padding:14px 16px;background:${SOFT};border-left:3px solid ${BRAND};border-radius:6px;">${html}</div>`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr><td style="border-radius:8px;background:${BRAND};">
  <a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
</td></tr></table>`;

function details(rows: [string, string | null | undefined][]) {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid ${LINE};margin-top:8px;">${shown
    .map(([k, v]) => `<tr><td style="padding:8px 0;width:96px;font:400 13px/1.5 ${FONT};color:${MUTED};vertical-align:top;">${esc(k)}</td><td style="padding:8px 0;font:400 13px/1.5 ${FONT};color:${INK};">${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

// ---------- the emails ----------

/** To the team: a visitor opened a ticket or a live chat. Reply-to is the visitor when they gave an email. */
export function newTicketMail(o: { to: string; chatbot: string; live: boolean; message: string; name?: string | null; email?: string | null; dashboardUrl: string }): Mail {
  const who = o.name || o.email || "A visitor";
  const kind = o.live ? "Live chat" : "New message";
  const title = o.live ? `${who} wants to chat now` : `${who} left a message`;
  const action = o.live ? "They are waiting in the chat window. Reply from the dashboard to answer them there."
    : o.email ? "Reply from the dashboard, or answer this email to write to them directly."
    : "Reply from the dashboard.";
  return {
    to: o.to,
    replyTo: o.email ?? undefined,
    subject: `${kind} from ${who} · ${o.chatbot}`,
    text: `${title}\n\n${o.message}\n\n${o.name ? `Name: ${o.name}\n` : ""}${o.email ? `Email: ${o.email}\n` : ""}Chatbot: ${o.chatbot}\n\n${action}\n${o.dashboardUrl}`,
    html: layout({
      preheader: o.message.slice(0, 120),
      eyebrow: `${kind} · ${o.chatbot}`,
      title,
      body: `${quote(para(o.message))}
        ${details([["Name", o.name], ["Email", o.email], ["Chatbot", o.chatbot], ["Type", o.live ? "Live chat" : "Reply by email"]])}
        <p style="margin:20px 0 0;color:${MUTED};font-size:14px;">${esc(action)}</p>
        ${button(o.dashboardUrl, o.live ? "Open the chat" : "Reply in the dashboard")}`,
      footer: `You get this because your email is set under Handoff for ${esc(o.chatbot)}. Change it in the dashboard.`,
    }),
  };
}

/**
 * Where a visitor's reply to our email goes. With RESEND_INBOUND_DOMAIN: reply+<ticket id>@that domain, which Resend
 * hands to inbound.ts so the reply lands in the dashboard thread. Without it: the team's handoff email.
 */
export const replyAddress = (ticketId: string, teamEmail?: string | null) =>
  process.env.RESEND_INBOUND_DOMAIN ? `reply+${ticketId}@${process.env.RESEND_INBOUND_DOMAIN}` : teamEmail ?? undefined;

/** To the visitor: the team answered their ticket. */
export function replyMail(o: { to: string; ticketId: string; chatbot: string; reply: string; question?: string | null; teamEmail?: string | null }): Mail {
  const title = `${o.chatbot} replied to your question`;
  const replyTo = replyAddress(o.ticketId, o.teamEmail);
  const answerHint = replyTo ? "Reply to this email to continue the conversation." : "Open the chat on our website to ask anything else.";
  return {
    to: o.to,
    replyTo,
    subject: `Re: your question to ${o.chatbot}`,
    text: `${o.reply}\n\n${o.question ? `You asked:\n> ${o.question.replace(/\n/g, "\n> ")}\n\n` : ""}${answerHint}`,
    html: layout({
      preheader: o.reply.slice(0, 120),
      eyebrow: "Reply from our team",
      title,
      body: `<p style="margin:0;">${para(o.reply)}</p>
        ${o.question ? `<p style="margin:24px 0 0;font-size:13px;color:${MUTED};">You asked</p>${quote(`<span style="font-size:14px;color:${MUTED};">${para(o.question)}</span>`)}` : ""}
        <p style="margin:20px 0 0;color:${MUTED};font-size:14px;">${esc(answerHint)}</p>`,
      footer: `You get this because you left a message for ${esc(o.chatbot)} in the chat on its website.`,
    }),
  };
}
