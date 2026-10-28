"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getMyCompany } from "@/features/employer-company/api/company-client";
import { getSite, getCompanyProfile } from "@/features/company-site/api/client";
import type { SiteState } from "@/features/company-site/api/model";
import { loadPreviewData } from "@/features/company-site/public/preview-data";
import type { CompanySitePreviewData } from "@/features/company-site/editor";

export type CareersEditorResult =
  | { ok: true; site: SiteState; role: "owner" | "recruiter"; preview: CompanySitePreviewData; notice?: string }
  | { ok: false; code: "forbidden" | "company_inactive" | "unauthenticated" | "unavailable" };

/** No company selector crosses the client boundary: membership comes from the session. */
export async function loadCareersEditor(): Promise<CareersEditorResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, code: "unauthenticated" };
    const site = await getSite(token);
    if (site.kind !== "success") {
      if (site.kind === "unauthenticated") return { ok: false, code: "unauthenticated" };
      if (site.kind === "error" && (site.code === "forbidden" || site.code === "company_inactive")) return { ok: false, code: site.code };
      return { ok: false, code: "unavailable" };
    }
    const membership = await getMyCompany({ token });
    if (!membership.ok) {
      const status = "status" in membership.error ? membership.error.status : undefined;
      const code = membership.envelope?.code;
      if (status === 401) return { ok: false, code: "unauthenticated" };
      if (status === 403 && (code === "forbidden" || code === "company_inactive")) return { ok: false, code };
      return { ok: false, code: "unavailable" };
    }
    const { company, company_id, role } = membership.data;
    // Only this server-resolved membership id can select the public identity.
    const profile = await getCompanyProfile(company_id).catch(() => ({ ok: false as const }));
    const preview = await loadPreviewData(profile.ok ? profile.company : {
      id: company_id, name: company.name, location: company.location,
      logo_url: null, description: null, website: null, linkedin_url: null,
      instagram_url: null, facebook_url: null, twitter_url: null,
    }, site.data.draft.blocks);
    return { ok: true, site: site.data, role, preview, ...(!profile.ok ? { notice: "No pudimos cargar el perfil de la empresa. Puedes seguir editando." } : {}) };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
