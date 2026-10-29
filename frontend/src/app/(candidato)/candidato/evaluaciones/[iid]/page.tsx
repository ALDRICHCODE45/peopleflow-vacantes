import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header";
import { AccountAssessmentPage } from "@/features/psychometrics/candidate/account-page";
export { metadata } from "@/features/psychometrics/candidate/page";
export default async function Page({ params }: { params: Promise<{ iid: string }> }) {
  const { iid } = await params;
  return <><CandidateHeader title="Evaluación" heading={false} parent={{ label: "Postulaciones", href: "/candidato/postulaciones" }} /><AccountAssessmentPage invitationId={iid} /></>;
}
