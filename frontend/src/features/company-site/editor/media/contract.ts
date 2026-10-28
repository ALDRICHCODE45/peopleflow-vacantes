import type { z } from "zod";
import type { MediaKind, UploadedMedia } from "../../media";
import type { mediaRefSchema } from "../../model";

/** A block's reference to uploaded media (`{ media_id }` or null), as stored in the draft. */
export type MediaRef = z.infer<typeof mediaRefSchema>;

/**
 * Contract between the section forms and the image field (T6d).
 *
 * The forms render `<ImageField>` for every image slot and only read/write the
 * draft's `MediaRef`. The field owns choosing a file, cropping it to the kind's
 * aspect ratio, uploading it and reporting progress/errors; it never edits the
 * draft directly.
 */
export type ImageFieldProps = {
  /** Upload kind; fixes the crop aspect: cover 16:9, gallery 4:3, portrait 1:1, story free. */
  kind: MediaKind;
  /** Visible field label, e.g. «Imagen de portada». */
  label: string;
  /** Optional helper text under the label. */
  description?: string;
  /** Current reference from the draft. */
  value: MediaRef;
  /** Called with the new reference after a successful upload, or null when removed. */
  onChange: (value: MediaRef, uploaded?: UploadedMedia) => void;
  /** Resolves a stored media id to a same-origin preview URL (already loaded media). */
  previewUrl?: (mediaId: string) => string | null;
  /** Field-level validation message from the draft, if any. */
  error?: string;
  disabled?: boolean;
};

export const cropAspects: Record<MediaKind, number | null> = {
  cover: 16 / 9,
  gallery: 4 / 3,
  portrait: 1,
  story: null,
};
