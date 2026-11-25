import { embedGuides, scriptTag } from "@/lib/embed";

/**
 * The /docs page as Markdown, for AI assistants and the "Copy page" button. Served at /docs.md.
 * Same content as components/docs.tsx (the platform guides come from lib/embed.ts): change both together.
 */
export function docsMarkdown(host: string): string {
  const slug = "your-chatbot-id";
  const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text}\n\`\`\``;
  const guides = embedGuides(host, slug).map((g) => [
    `### ${g.label}`,
    g.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    `\`${g.code.file}\`:`,
    fence(g.code.lang, g.code.text),
    g.note ? `> ${g.note}` : "",
  ].filter(Boolean).join("\n\n"));

  return `# Add Footnote to your website

Footnote is a help chatbot that answers visitors from your own FAQs and documents, names the source of each answer,
asks when it isn't sure, and hands off to a person when it can't help. No LLM or AI APIs are involved.
One script tag puts its chat button on any website.

Docs: ${host}/docs · This file: ${host}/docs.md

## Quick start

1. **Create a chatbot.** Sign up at ${host}, create a chatbot in the dashboard, and add your FAQs or documents.
2. **Copy its embed code.** The dashboard's *Install* tab shows it with your chatbot's id filled in.
3. **Paste it before \`</body>\`** on every page that should show the chat. Replace \`${slug}\` with your chatbot's id
   (shown under its name in the dashboard's chatbot switcher).

${fence("html", scriptTag(host, slug))}

## Step by step for your platform

Every guide adds the same script tag.

${guides.join("\n\n")}

## Options

Most settings (colors, position, icon, greeting, starter questions) live in the dashboard's *Customize* tab and apply
without changing the code. These attributes on the script tag override them for one site:

| Attribute | What it does |
| --- | --- |
| \`data-kb\` | Which chatbot to show (required) |
| \`data-title\` | The chat panel's title |
| \`data-greeting\` | The first message visitors see |

## Open it from your page

Once loaded, the widget adds \`window.chatbotWidget\`. Use it for your own "Chat with us" buttons, or to remove the
widget in a single-page app.

${fence("js", `// Open or close the chat panel
window.chatbotWidget?.open();
window.chatbotWidget?.close();

// Remove the widget completely (e.g. when leaving a page in a single-page app)
window.chatbotWidget?.destroy();`)}

## Allowed websites

In the dashboard's *Install* tab, list the addresses of your sites, one per line (e.g. \`shop.example.com\`). Browsers
then refuse to show your chatbot anywhere else. Leave the list empty to allow any site. List \`www.\` and the bare
domain separately if you use both.

## Troubleshooting

- **The chat button doesn't appear:** check that the script tag is on the page (view the page source), that
  \`data-kb\` is your chatbot's id, and that your site is in the allowed websites list, if you set one.
- **The chat shows a different chatbot:** \`data-kb\` names the chatbot. Copy the code again from the *Install* tab of
  the chatbot you want.
- **Design changes don't show:** press Save in *Customize*, then reload your site. Changes apply on the next page load.
- **It works locally but not on the live site:** add the live address (e.g. \`www.example.com\`) to the allowed
  websites, and clear any page cache your host or plugin keeps.
`.replace(/\r\n/g, "\n"); // the source file may be saved with Windows line endings
}
