import { AssessmentPage } from "@/features/psychometrics/candidate/page";

export { metadata } from "@/features/psychometrics/candidate/page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export default async function Page() {
  return AssessmentPage();
}
