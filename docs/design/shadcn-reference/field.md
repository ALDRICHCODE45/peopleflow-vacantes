<!-- Source: https://ui.shadcn.com/docs/components/base/field (fetched 2026-10-19). Official usage, composition and API for §19. -->

# field

Combine labels, controls, and help text to compose accessible form fields and grouped inputs.

## [Installation#](#installation)

## [Usage#](#usage)

```
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
```

```
<FieldSet>
  <FieldLegend>Profile</FieldLegend>
  <FieldDescription>This appears on invoices and emails.</FieldDescription>
  <FieldGroup>
    <Field>
      <FieldLabel htmlFor="name">Full name</FieldLabel>
      <Input id="name" autoComplete="off" placeholder="Evil Rabbit" />
      <FieldDescription>This appears on invoices and emails.</FieldDescription>
    </Field>
    <Field>
      <FieldLabel htmlFor="username">Username</FieldLabel>
      <Input id="username" autoComplete="off" aria-invalid />
      <FieldError>Choose another username.</FieldError>
    </Field>
    <Field orientation="horizontal">
      <Switch id="newsletter" />
      <FieldLabel htmlFor="newsletter">Subscribe to the newsletter</FieldLabel>
    </Field>
  </FieldGroup>
</FieldSet>
```

## [Composition#](#composition)

### [Field#](#field)

A single control with label, helper text, and validation.

```
Field
├── FieldLabel
├── Input / Textarea / Switch / Select
├── FieldDescription
└── FieldError
```

### [FieldGroup#](#fieldgroup)

Related fields in one group. Use `FieldSeparator` between sections when needed.

```
FieldGroup
├── Field
│   ├── FieldLabel
│   ├── Input / Textarea / Switch / Select
│   ├── FieldDescription
│   └── FieldError
├── FieldSeparator
└── Field
    ├── FieldLabel
    └── Input / Textarea / Switch / Select
```

### [FieldSet#](#fieldset)

Semantic grouping with a legend and description, usually containing a `FieldGroup`.

```
FieldSet
├── FieldLegend
├── FieldDescription
└── FieldGroup
    ├── Field
    │   ├── FieldLabel
    │   ├── Input / Textarea / Switch / Select
    │   ├── FieldDescription
    │   └── FieldError
    └── Field
        ├── FieldLabel
        └── Input / Textarea / Switch / Select
```

## [Anatomy#](#anatomy)

The `Field` family is designed for composing accessible forms. A typical field is structured as follows:

```
<Field>
  <FieldLabel htmlFor="input-id">Label</FieldLabel>
  {/* Input, Select, Switch, etc. */}
  <FieldDescription>Optional helper text.</FieldDescription>
  <FieldError>Validation message.</FieldError>
</Field>
```

*   `Field` is the core wrapper for a single field.
*   `FieldContent` is a flex column that groups label and description. Not required if you have no description.
*   Wrap related fields with `FieldGroup`, and use `FieldSet` with `FieldLegend` for semantic grouping.

## [Form#](#form)

See the [Form](/docs/forms) documentation for building forms with the `Field` component and [React Hook Form](/docs/forms/react-hook-form), [Tanstack Form](/docs/forms/tanstack-form), or [Formisch](/docs/forms/formisch).

## [Input#](#input)

## [Textarea#](#textarea)

## [Select#](#select)

## [Slider#](#slider)

## [Fieldset#](#fieldset-1)

## [Checkbox#](#checkbox)

## [Radio#](#radio)

## [Switch#](#switch)

## [Choice Card#](#choice-card)

Wrap `Field` components inside `FieldLabel` to create selectable field groups. This works with `RadioItem`, `Checkbox` and `Switch` components.

## [Field Group#](#field-group)

Stack `Field` components with `FieldGroup`. Add `FieldSeparator` to divide them.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [Responsive Layout#](#responsive-layout)

*   **Vertical fields:** Default orientation stacks label, control, and helper text—ideal for mobile-first layouts.
*   **Horizontal fields:** Set `orientation="horizontal"` on `Field` to align the label and control side-by-side. Pair with `FieldContent` to keep descriptions aligned.
*   **Responsive fields:** Set `orientation="responsive"` for automatic column layouts inside container-aware parents. Apply `@container/field-group` classes on `FieldGroup` to switch orientations at specific breakpoints.

## [Validation and Errors#](#validation-and-errors)

*   Add `data-invalid` to `Field` to switch the entire block into an error state.
*   Add `aria-invalid` on the input itself for assistive technologies.
*   Render `FieldError` immediately after the control or inside `FieldContent` to keep error messages aligned with the field.

```
<Field data-invalid>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" type="email" aria-invalid />
  <FieldError>Enter a valid email address.</FieldError>
</Field>
```

## [Accessibility#](#accessibility)

*   `FieldSet` and `FieldLegend` keep related controls grouped for keyboard and assistive tech users.
*   `Field` outputs `role="group"` so nested controls inherit labeling from `FieldLabel` and `FieldLegend` when combined.
*   Apply `FieldSeparator` sparingly to ensure screen readers encounter clear section boundaries.

## [API Reference#](#api-reference)

### [FieldSet#](#fieldset-2)

Container that renders a semantic `fieldset` with spacing presets.

Prop

Type

Default

`className`

`string`

```
<FieldSet>
  <FieldLegend>Delivery</FieldLegend>
  <FieldGroup>{/* Fields */}</FieldGroup>
</FieldSet>
```

### [FieldLegend#](#fieldlegend)

Legend element for a `FieldSet`. Switch to the `label` variant to align with label sizing.

Prop

Type

Default

`variant`

`"legend" | "label"`

`"legend"`

`className`

`string`

```
<FieldLegend variant="label">Notification Preferences</FieldLegend>
```

The `FieldLegend` has two variants: `legend` and `label`. The `label` variant applies label sizing and alignment. Handy if you have nested `FieldSet`.

### [FieldGroup#](#fieldgroup-1)

Layout wrapper that stacks `Field` components and enables container queries for responsive orientations.

Prop

Type

Default

`className`

`string`

```
<FieldGroup className="@container/field-group flex flex-col gap-6">
  <Field>{/* ... */}</Field>
  <Field>{/* ... */}</Field>
</FieldGroup>
```

### [Field#](#field-1)

The core wrapper for a single field. Provides orientation control, invalid state styling, and spacing.

Prop

Type

Default

`orientation`

`"vertical" | "horizontal" | "responsive"`

`"vertical"`

`className`

`string`

`data-invalid`

`boolean`

```
<Field orientation="horizontal">
  <FieldLabel htmlFor="remember">Remember me</FieldLabel>
  <Switch id="remember" />
</Field>
```

### [FieldContent#](#fieldcontent)

Flex column that groups control and descriptions when the label sits beside the control. Not required if you have no description.

Prop

Type

Default

`className`

`string`

```
<Field>
  <Checkbox id="notifications" />
  <FieldContent>
    <FieldLabel htmlFor="notifications">Notifications</FieldLabel>
    <FieldDescription>Email, SMS, and push options.</FieldDescription>
  </FieldContent>
</Field>
```

### [FieldLabel#](#fieldlabel)

Label styled for both direct inputs and nested `Field` children.

Prop

Type

Default

`className`

`string`

```
<FieldLabel htmlFor="email">Email</FieldLabel>
```

### [FieldTitle#](#fieldtitle)

Renders a title with label styling inside `FieldContent`.

Prop

Type

Default

`className`

`string`

```
<FieldContent>
  <FieldTitle>Enable Touch ID</FieldTitle>
  <FieldDescription>Unlock your device faster.</FieldDescription>
</FieldContent>
```

### [FieldDescription#](#fielddescription)

Helper text slot that automatically balances long lines in horizontal layouts.

Prop

Type

Default

`className`

`string`

```
<FieldDescription>We never share your email with anyone.</FieldDescription>
```

### [FieldSeparator#](#fieldseparator)

Visual divider to separate sections inside a `FieldGroup`. Accepts optional inline content.

Prop

Type

Default

`className`

`string`

```
<FieldSeparator>Or continue with</FieldSeparator>
```

### [FieldError#](#fielderror)

Accessible error container that accepts children or an `errors` array (e.g., from `react-hook-form`).

Prop

Type

Default

`errors`

`Array<{ message?: string } | undefined>`

`className`

`string`

```
<FieldError errors={errors.username} />
```

When the `errors` array contains multiple messages, the component renders a list automatically.

`FieldError` also accepts issues produced by any validator that implements [Standard Schema](https://standardschema.dev/), including Zod, Valibot, and ArkType. Pass the `issues` array from the schema result directly to render a unified error list across libraries.