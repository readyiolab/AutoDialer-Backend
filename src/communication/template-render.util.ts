export type TemplateRenderVars = {
  link?: string | null;
  customerName?: string | null;
  [key: string]: string | null | undefined;
};

/**
 * Replace known placeholders in message templates.
 * Supports {link}, {utm}, {{utm}}, {customerName}, and any other {key} from vars.
 */
export function renderMessageTemplate(
  content: string,
  vars: TemplateRenderVars = {},
): string {
  if (!content) return '';
  const link = (vars.link || vars.utm || '').trim();
  const customerName = (vars.customerName || '').trim() || 'there';

  let out = content;
  out = out.replace(/\{\{\s*utm\s*\}\}/gi, link);
  out = out.replace(/\{\s*utm\s*\}/gi, link);
  out = out.replace(/\{\s*link\s*\}/gi, link);
  out = out.replace(/\{\s*customerName\s*\}/gi, customerName);

  for (const [key, value] of Object.entries(vars)) {
    if (key === 'link' || key === 'utm' || key === 'customerName') continue;
    if (value == null) continue;
    const re = new RegExp(`\\{\\s*${escapeRegExp(key)}\\s*\\}`, 'gi');
    out = out.replace(re, String(value));
  }

  return out;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Score how well a template name/category matches a campaign name (higher = better). */
export function templateCampaignMatchScore(
  campaignName: string | null | undefined,
  templateName: string,
  category?: string | null,
): number {
  if (!campaignName?.trim()) return 0;
  const camp = campaignName.trim().toLowerCase();
  const name = templateName.trim().toLowerCase();
  const cat = (category || '').trim().toLowerCase();
  if (cat && (camp.includes(cat) || cat.includes(camp))) return 100;
  if (name && (camp.includes(name) || name.includes(camp))) return 90;
  // token overlap (e.g. InstantRupiya vs Instant Rupiya)
  const campTokens = camp.split(/[\s_\-]+/).filter((t) => t.length > 2);
  let score = 0;
  for (const t of campTokens) {
    if (name.includes(t) || cat.includes(t)) score += 20;
  }
  return score;
}
