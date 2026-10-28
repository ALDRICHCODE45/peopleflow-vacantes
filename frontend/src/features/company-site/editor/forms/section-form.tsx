"use client";

import type { Dispatch } from "react";
import { FieldGroup, FieldError } from "@/components/ui/field";
import type { EditorAction, MappedFieldError } from "../../editor-state";
import type { SiteBlock } from "../../model";
import { SimpleForm } from "./simple-form";
import { CollectionForm } from "./collection-form";
import { fieldMessage } from "./fields";

export type FormProps = { block: SiteBlock; dispatch: Dispatch<Extract<EditorAction, { type: "content" }>>; fieldErrors: MappedFieldError[] };
/** The only write boundary is the existing content action; autosave owns I/O. */
export function SectionForm(props: FormProps) {
  return <FieldGroup key={props.block.id}>
    {fieldMessage(props.fieldErrors, props.block.id, "") && <FieldError>{fieldMessage(props.fieldErrors, props.block.id, "")}</FieldError>}
    {"items" in props.block.content ? <CollectionForm {...props} /> : <SimpleForm {...props} />}
  </FieldGroup>;
}
