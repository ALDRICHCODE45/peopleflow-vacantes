/** Publishing requirement, never HTML `required`: incomplete drafts can be saved.
 * The shared footnote supplies the meaning without changing existing field names.
 */
export function PublicationRequired({ required = true }: { required?: boolean }) {
  return required ? <span data-pf-publication-required="" aria-hidden="true" className="text-primary">*</span> : null;
}
